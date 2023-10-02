import path from "node:path";
import {toHexString} from "@chainsafe/ssz";
import {phase0, Epoch, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Logger, MapDef, ensureDir} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {loadCachedBeaconState} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {LinkedList} from "../../util/array.js";
import {IClock} from "../../util/clock.js";
import {ShufflingCache} from "../shufflingCache.js";
import {MapTracker} from "./mapMetrics.js";
import {
  CHECKPOINT_STATES_FOLDER,
  CacheType,
  CheckpointHex,
  PersistentCheckpointStateCacheModules,
  PersistentCheckpointStateCacheOpts,
  FILE_APIS,
  GetHeadStateFn,
  PersistentApis,
  RemoveFileReason,
  StateFile,
  CheckpointStateCache,
} from "./types.js";
import {from} from "multiformats/dist/types/src/bases/base.js";

/**
 * Cache of CachedBeaconState belonging to checkpoint
 * - If it's more than MAX_STATES_IN_MEMORY epochs old, it will be persisted to disk following LRU cache
 * - Once a chain gets finalized we'll prune all states from memory and disk for epochs < finalizedEpoch
 * - In get*() apis if shouldReload is true, it will reload from disk
 *
 * Similar API to Repository
 */
export class PersistentCheckpointStateCache implements CheckpointStateCache {
  private readonly cache: MapTracker<string, CachedBeaconStateAllForks | StateFile>;
  // key order of in memory items to implement LRU cache
  private readonly inMemoryKeyOrder: LinkedList<string>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new MapDef<Epoch, Set<string>>(() => new Set<string>());
  private readonly metrics: Metrics["cpStateCache"] | null | undefined;
  private readonly logger: Logger;
  private readonly clock: IClock | null | undefined;
  private preComputedCheckpoint: string | null = null;
  private preComputedCheckpointHits: number | null = null;
  private readonly maxEpochsInMemory: number;
  private readonly persistentApis: PersistentApis;
  private readonly shufflingCache: ShufflingCache;
  private readonly getHeadState?: GetHeadStateFn;

  constructor(
    {metrics, logger, clock, shufflingCache, getHeadState, persistentApis}: PersistentCheckpointStateCacheModules,
    opts: PersistentCheckpointStateCacheOpts
  ) {
    this.cache = new MapTracker(metrics?.cpStateCache);
    if (metrics) {
      this.metrics = metrics.cpStateCache;
      metrics.cpStateCache.size.addCollect(() => {
        let fileCount = 0;
        let stateCount = 0;
        const memoryEpochs = new Set<Epoch>();
        const persistentEpochs = new Set<Epoch>();
        for (const [key, value] of this.cache.entries()) {
          const {epoch} = fromCheckpointKey(key);
          if (typeof value === "string") {
            fileCount++;
            memoryEpochs.add(epoch);
          } else {
            stateCount++;
            persistentEpochs.add(epoch);
          }
        }
        metrics.cpStateCache.size.set({type: CacheType.file}, fileCount);
        metrics.cpStateCache.size.set({type: CacheType.state}, stateCount);
        metrics.cpStateCache.epochSize.set({type: CacheType.file}, persistentEpochs.size);
        metrics.cpStateCache.epochSize.set({type: CacheType.state}, memoryEpochs.size);
      });
    }
    this.logger = logger;
    this.clock = clock;
    this.maxEpochsInMemory = opts.maxEpochsInMemory;
    // Specify different persistentApis for testing
    this.persistentApis = persistentApis ?? FILE_APIS;
    this.shufflingCache = shufflingCache;
    this.getHeadState = getHeadState;
    this.inMemoryKeyOrder = new LinkedList<string>();
    void ensureDir(CHECKPOINT_STATES_FOLDER);
  }

  /**
   * Get a state from cache, it will reload from disk.
   * This is expensive api, should only be called in some important flows:
   * - Validate a gossip block
   * - Get block for processing
   * - Regen head state
   */
  async getOrReload(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | null> {
    const cpKey = toCheckpointKey(cp);
    const inMemoryState = this.get(cpKey);
    if (inMemoryState) {
      return inMemoryState;
    }

    const filePath = this.cache.get(cpKey);
    if (filePath === undefined) {
      return null;
    }

    if (typeof filePath !== "string") {
      // should not happen, in-memory state is handled above
      throw new Error("Expected file path");
    }

    // reload from disk based on closest checkpoint
    this.logger.verbose("Reload: read state from disk", {filePath});
    const newStateBytes = await this.persistentApis.readFile(filePath);
    this.logger.verbose("Reload: read state from disk successfully", {filePath});
    this.metrics?.stateFilesRemoveCount.inc({reason: RemoveFileReason.reload});
    this.metrics?.stateReloadSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
    const closestState = findClosestCheckpointState(cp, this.cache) ?? this.getHeadState?.();
    if (closestState == null) {
      throw new Error("No closest state found for cp " + toCheckpointKey(cp));
    }
    this.metrics?.stateReloadEpochDiff.observe(Math.abs(closestState.epochCtx.epoch - cp.epoch));
    this.logger.verbose("Reload: found closest state", {filePath, seedSlot: closestState.slot});
    const timer = this.metrics?.stateReloadDuration.startTimer();

    try {
      const newCachedState = loadCachedBeaconState(closestState, newStateBytes, {
        shufflingGetter: this.shufflingCache.get.bind(this.shufflingCache),
      });
      timer?.();
      this.logger.verbose("Reload state successfully from disk", {
        filePath,
        stateSlot: newCachedState.slot,
        seedSlot: closestState.slot,
      });
      // only remove file once we reload successfully
      void this.persistentApis.removeFile(filePath);
      this.cache.set(cpKey, newCachedState);
      // since item is file path, cpKey is not in inMemoryKeyOrder
      this.inMemoryKeyOrder.unshift(cpKey);
      // don't prune from memory here, call it at the last 1/3 of slot 0 of an epoch
      return newCachedState;
    } catch (e) {
      this.logger.debug("Error reloading state from disk", {filePath}, e as Error);
      return null;
    }
    return null;
  }

  /**
   * Return either state or state bytes without reloading from disk.
   */
  async getStateOrBytes(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | Uint8Array | null> {
    const cpKey = toCheckpointKey(cp);
    const inMemoryState = this.get(cpKey);
    if (inMemoryState) {
      return inMemoryState;
    }

    const filePath = this.cache.get(cpKey);
    if (filePath === undefined) {
      return null;
    }

    if (typeof filePath !== "string") {
      // should not happen, in-memory state is handled above
      throw new Error("Expected file path");
    }

    // do not reload from disk
    return this.persistentApis.readFile(filePath);
  }

  /**
   * Similar to get() api without reloading from disk
   */
  get(cpOrKey: CheckpointHex | string): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const cpKey = typeof cpOrKey === "string" ? cpOrKey : toCheckpointKey(cpOrKey);
    const stateOrFilePath = this.cache.get(cpKey);

    if (stateOrFilePath === undefined) {
      return null;
    }

    this.metrics?.hits.inc();

    if (cpKey === this.preComputedCheckpoint) {
      this.preComputedCheckpointHits = (this.preComputedCheckpointHits ?? 0) + 1;
    }

    if (typeof stateOrFilePath !== "string") {
      this.metrics?.stateClonedCount.observe(stateOrFilePath.clonedCount);
      this.inMemoryKeyOrder.moveToHead(cpKey);
      return stateOrFilePath;
    }

    return null;
  }

  /**
   * Add a state of a checkpoint to this cache, prune from memory if necessary.
   */
  add(cp: phase0.Checkpoint, state: CachedBeaconStateAllForks): void {
    const cpHex = toCheckpointHex(cp);
    const key = toCheckpointKey(cpHex);
    const stateOrFilePath = this.cache.get(key);
    if (stateOrFilePath !== undefined) {
      if (typeof stateOrFilePath === "string") {
        // was persisted to disk, set back to memory
        this.cache.set(key, state);
        void this.persistentApis.removeFile(stateOrFilePath);
        this.metrics?.stateFilesRemoveCount.inc({reason: RemoveFileReason.stateUpdate});
        this.inMemoryKeyOrder.unshift(key);
      } else {
        // already in memory
        // move to head of inMemoryKeyOrder
        this.inMemoryKeyOrder.moveToHead(key);
      }
      return;
    }
    this.metrics?.adds.inc();
    this.cache.set(key, state);
    this.inMemoryKeyOrder.unshift(key);
    this.epochIndex.getOrDefault(cp.epoch).add(cpHex.rootHex);
    // don't prune from memory here, call it at the last 1/3 of slot 0 of an epoch
  }

  /**
   * Searches in-memory state for the latest cached state with a `root` without reload, starting with `epoch` and descending
   */
  getLatest(rootHex: RootHex, maxEpoch: Epoch): CachedBeaconStateAllForks | null {
    // sort epochs in descending order, only consider epochs lte `epoch`
    const epochs = Array.from(this.epochIndex.keys())
      .sort((a, b) => b - a)
      .filter((e) => e <= maxEpoch);
    for (const epoch of epochs) {
      if (this.epochIndex.get(epoch)?.has(rootHex)) {
        const inMemoryState = this.get({rootHex, epoch});
        if (inMemoryState) {
          return inMemoryState;
        }
      }
    }
    return null;
  }

  /**
   * Searches state for the latest cached state with a `root`, reload if needed, starting with `epoch` and descending
   * This is expensive api, should only be called in some important flows:
   * - Validate a gossip block
   * - Get block for processing
   * - Regen head state
   */
  async getOrReloadLatest(rootHex: RootHex, maxEpoch: Epoch): Promise<CachedBeaconStateAllForks | null> {
    // sort epochs in descending order, only consider epochs lte `epoch`
    const epochs = Array.from(this.epochIndex.keys())
      .sort((a, b) => b - a)
      .filter((e) => e <= maxEpoch);
    for (const epoch of epochs) {
      if (this.epochIndex.get(epoch)?.has(rootHex)) {
        try {
          const state = await this.getOrReload({rootHex, epoch});
          if (state) {
            return state;
          }
        } catch (e) {
          this.logger.debug("Error get or reload state", {epoch, rootHex}, e as Error);
        }
      }
    }
    return null;
  }

  /**
   * Update the precomputed checkpoint and return the number of his for the
   * previous one (if any).
   */
  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null {
    const previousHits = this.preComputedCheckpointHits;
    this.preComputedCheckpoint = toCheckpointKey({rootHex, epoch});
    this.preComputedCheckpointHits = 0;
    return previousHits;
  }

  pruneFinalized(finalizedEpoch: Epoch): void {
    for (const epoch of this.epochIndex.keys()) {
      if (epoch < finalizedEpoch) {
        this.deleteAllEpochItems(epoch);
      }
    }
  }

  /**
   * For testing only
   */
  delete(cp: phase0.Checkpoint): void {
    const key = toCheckpointKey(toCheckpointHex(cp));
    this.cache.delete(key);
    this.inMemoryKeyOrder.deleteFirst(key);
    const epochKey = toHexString(cp.root);
    const value = this.epochIndex.get(cp.epoch);
    if (value) {
      value.delete(epochKey);
      if (value.size === 0) {
        this.epochIndex.delete(cp.epoch);
      }
    }
  }

  /**
   * Delete all items of an epoch from disk and memory
   */
  deleteAllEpochItems(epoch: Epoch): void {
    for (const rootHex of this.epochIndex.get(epoch) || []) {
      const key = toCheckpointKey({rootHex, epoch});
      const stateOrFilePath = this.cache.get(key);
      if (stateOrFilePath !== undefined && typeof stateOrFilePath === "string") {
        void this.persistentApis.removeFile(stateOrFilePath);
        this.metrics?.stateFilesRemoveCount.inc({reason: RemoveFileReason.pruneFinalized});
      }
      // this could be improved by looping through inMemoryKeyOrder once
      // however with this.maxEpochsInMemory = 2, the list is 6 maximum so it's not a big deal now
      this.cache.delete(key);
      this.inMemoryKeyOrder.deleteFirst(key);
    }
    this.epochIndex.delete(epoch);
  }

  /**
   * This is slow code because it involves serializing the whole state to disk which takes 600ms as of Sep 2023
   * The add() is called after we process 1st block of an epoch, we don't want to pruneFromMemory at that time since it's the hot time
   * Call this code at the last 1/3 slot of slot 0 of an epoch
   */
  pruneFromMemory(): number {
    let count = 0;
    while (this.inMemoryKeyOrder.length > 0 && this.countEpochsInMemory() > this.maxEpochsInMemory) {
      const key = this.inMemoryKeyOrder.last();
      if (!key) {
        // should not happen
        throw new Error(`No key ${key} found in inMemoryKeyOrder}`);
      }
      const stateOrFilePath = this.cache.get(key);
      // even if stateOrFilePath is undefined or string, we still need to pop the key
      this.inMemoryKeyOrder.pop();
      if (stateOrFilePath !== undefined && typeof stateOrFilePath !== "string") {
        // do not update epochIndex
        const filePath = toTmpFilePath(key);
        this.metrics?.statePersistSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
        const timer = this.metrics?.statePersistDuration.startTimer();
        void this.persistentApis.writeIfNotExist(filePath, stateOrFilePath.serialize());
        timer?.();
        this.cache.set(key, filePath);
        count++;
        this.logger.verbose("Persist state to disk", {filePath, stateSlot: stateOrFilePath.slot});
      } else {
        // should not happen, log anyway
        this.logger.debug(`Unexpected stateOrFilePath ${stateOrFilePath} for key ${key}`);
      }
    }

    return count;
  }

  private countEpochsInMemory(): number {
    const epochs = new Set<Epoch>();
    for (const key of this.inMemoryKeyOrder) {
      epochs.add(fromCheckpointKey(key).epoch);
    }
    return epochs.size;
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
  }

  /** ONLY FOR DEBUGGING PURPOSES. For lodestar debug API */
  dumpSummary(): routes.lodestar.StateCacheItem[] {
    return Array.from(this.cache.keys()).map((key) => {
      const cp = fromCheckpointKey(key);
      return {
        slot: computeStartSlotAtEpoch(cp.epoch),
        root: cp.rootHex,
        reads: this.cache.readCount.get(key) ?? 0,
        lastRead: this.cache.lastRead.get(key) ?? 0,
        checkpointState: true,
        filePath: typeof this.cache.get(key) === "string" ? (this.cache.get(key) as string) : undefined,
      };
    });
  }

  /** ONLY FOR DEBUGGING PURPOSES. For spec tests on error */
  dumpCheckpointKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * Find closest state from cache to provided checkpoint.
 * Note that in 0-historical state configuration, this could return null and we should get head state in that case.
 */
export function findClosestCheckpointState(
  cp: CheckpointHex,
  cache: Map<string, CachedBeaconStateAllForks | StateFile>
): CachedBeaconStateAllForks | null {
  let smallestEpochDiff = Infinity;
  let closestState: CachedBeaconStateAllForks | null = null;
  for (const [key, value] of cache.entries()) {
    // ignore entries with StateFile
    if (typeof value === "string") {
      continue;
    }
    const epochDiff = Math.abs(cp.epoch - fromCheckpointKey(key).epoch);
    if (epochDiff < smallestEpochDiff) {
      smallestEpochDiff = epochDiff;
      closestState = value;
    }
  }

  return closestState;
}

export function toCheckpointHex(checkpoint: phase0.Checkpoint): CheckpointHex {
  return {
    epoch: checkpoint.epoch,
    rootHex: toHexString(checkpoint.root),
  };
}

export function toCheckpointKey(cp: CheckpointHex): string {
  return `${cp.rootHex}_${cp.epoch}`;
}

export function fromCheckpointKey(key: string): CheckpointHex {
  const [rootHex, epoch] = key.split("_");
  return {
    rootHex,
    epoch: Number(epoch),
  };
}

export function toTmpFilePath(key: string): string {
  return path.join(CHECKPOINT_STATES_FOLDER, key);
}
