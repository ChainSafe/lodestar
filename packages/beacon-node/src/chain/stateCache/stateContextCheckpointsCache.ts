import path from "node:path";
import fs from "node:fs";
import {toHexString} from "@chainsafe/ssz";
import {phase0, Epoch, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {MapDef, ensureDir, removeFile, writeIfNotExist} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {loadCachedBeaconState} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {LinkedList} from "../../util/array.js";
import {IClock} from "../../util/clock.js";
import {ShufflingCache} from "../shufflingCache.js";
import {MapTracker} from "./mapMetrics.js";

export type CheckpointHex = {epoch: Epoch; rootHex: RootHex};

// Make this generic to support testing
export type PersistentApis = {
  writeIfNotExist: (filepath: string, bytes: Uint8Array) => Promise<boolean>;
  removeFile: (path: string) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array>;
  ensureDir: (path: string) => Promise<void>;
};

// Default persistent api for a regular node, use other persistent apis for testing
const FILE_APIS: PersistentApis = {
  writeIfNotExist,
  removeFile,
  readFile: fs.promises.readFile,
  ensureDir,
};

const CHECKPOINT_STATES_FOLDER = "./unfinalized_checkpoint_states";

export type StateFile = string;

/**
 * Keep max n states in memory, persist the rest to disk
 */
const MAX_EPOCHS_IN_MEMORY = 2;

enum CacheType {
  state = "state",
  file = "file",
}

// Reason to remove a state file from disk
enum RemoveFileReason {
  pruneFinalized = "prune_finalized",
  reload = "reload",
  stateUpdate = "state_update",
}

/**
 * Cache of CachedBeaconState belonging to checkpoint
 * - If it's more than MAX_STATES_IN_MEMORY epochs old, it will be persisted to disk following LRU cache
 * - Once a chain gets finalized we'll prune all states from memory and disk for epochs < finalizedEpoch
 * - In get*() apis if shouldReload is true, it will reload from disk
 *
 * Similar API to Repository
 */
export class CheckpointStateCache {
  private readonly cache: MapTracker<string, CachedBeaconStateAllForks | StateFile>;
  // key order of in memory items to implement LRU cache
  private readonly inMemoryKeyOrder: LinkedList<string>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new MapDef<Epoch, Set<string>>(() => new Set<string>());
  private readonly metrics: Metrics["cpStateCache"] | null | undefined;
  private readonly clock: IClock | null | undefined;
  private preComputedCheckpoint: string | null = null;
  private preComputedCheckpointHits: number | null = null;
  private readonly maxEpochsInMemory: number;
  private readonly persistentApis: PersistentApis;
  private readonly shufflingCache: ShufflingCache;

  constructor({
    metrics,
    clock,
    maxEpochsInMemory,
    shufflingCache,
    persistentApis,
  }: {
    metrics?: Metrics | null;
    clock?: IClock | null;
    maxEpochsInMemory?: number;
    shufflingCache: ShufflingCache;
    persistentApis?: PersistentApis;
  }) {
    this.cache = new MapTracker(metrics?.cpStateCache);
    if (metrics) {
      this.metrics = metrics.cpStateCache;
      metrics.cpStateCache.size.addCollect(() => {
        let fileCount = 0;
        let stateCount = 0;
        for (const value of this.cache.values()) {
          if (typeof value === "string") {
            fileCount++;
          } else {
            stateCount++;
          }
        }
        metrics.cpStateCache.size.set({type: CacheType.file}, fileCount);
        metrics.cpStateCache.size.set({type: CacheType.state}, stateCount);
      });
      metrics.cpStateCache.epochSize.addCollect(() => metrics.cpStateCache.epochSize.set(this.epochIndex.size));
    }
    this.clock = clock;
    this.maxEpochsInMemory = maxEpochsInMemory ?? MAX_EPOCHS_IN_MEMORY;
    // Specify different persistentApis for testing
    this.persistentApis = persistentApis ?? FILE_APIS;
    this.shufflingCache = shufflingCache;
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
    const newStateBytes = await this.persistentApis.readFile(filePath);
    void this.persistentApis.removeFile(filePath);
    this.metrics?.stateFilesRemoveCount.inc({reason: RemoveFileReason.reload});
    this.metrics?.stateReloadSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
    const closestState = findClosestCheckpointState(cp, this.cache);
    this.metrics?.stateReloadEpochDiff.observe(Math.abs(closestState.epochCtx.epoch - cp.epoch));
    const timer = this.metrics?.stateReloadDuration.startTimer();
    const newCachedState = loadCachedBeaconState(closestState, newStateBytes, {
      shufflingGetter: this.shufflingCache.get.bind(this.shufflingCache),
    });
    timer?.();
    this.cache.set(cpKey, newCachedState);
    // since item is file path, cpKey is not in inMemoryKeyOrder
    this.inMemoryKeyOrder.unshift(cpKey);
    this.pruneFromMemory();
    return newCachedState;
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
    this.pruneFromMemory();
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
        const state = await this.getOrReload({rootHex, epoch});
        if (state) {
          return state;
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
    this.cache.delete(toCheckpointKey(toCheckpointHex(cp)));
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
      this.cache.delete(key);
    }
    this.epochIndex.delete(epoch);
  }

  /**
   * This is slow code because it involves serializing the whole state to disk which takes ~1.2s as of Sep 2023
   * However this is mostly consumed from add() function which is called in PrepareNextSlotScheduler
   * This happens at the last 1/3 slot of the last slot of an epoch so hopefully it's not a big deal
   */
  private pruneFromMemory(): void {
    while (this.inMemoryKeyOrder.length > 0 && this.countEpochsInMemory() > this.maxEpochsInMemory) {
      const key = this.inMemoryKeyOrder.last();
      if (!key) {
        // should not happen
        throw new Error("No key");
      }
      const stateOrFilePath = this.cache.get(key);
      if (stateOrFilePath !== undefined && typeof stateOrFilePath !== "string") {
        // should always be the case
        this.inMemoryKeyOrder.pop();
        // do not update epochIndex
        const filePath = toTmpFilePath(key);
        this.metrics?.statePersistSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
        const timer = this.metrics?.statePersistDuration.startTimer();
        void this.persistentApis.writeIfNotExist(filePath, stateOrFilePath.serialize());
        timer?.();
        this.cache.set(key, filePath);
      }
    }
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
    return Array.from(this.cache.keys()).map(([key]) => {
      const cp = fromCheckpointKey(key);
      return {
        slot: computeStartSlotAtEpoch(cp.epoch),
        root: cp.rootHex,
        reads: this.cache.readCount.get(key) ?? 0,
        lastRead: this.cache.lastRead.get(key) ?? 0,
        checkpointState: true,
        // TODO: also return state or file path
      };
    });
  }

  /** ONLY FOR DEBUGGING PURPOSES. For spec tests on error */
  dumpCheckpointKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

export function findClosestCheckpointState(
  cp: CheckpointHex,
  cache: Map<string, CachedBeaconStateAllForks | StateFile>
): CachedBeaconStateAllForks {
  let smallestEpochDiff = Infinity;
  let closestState: CachedBeaconStateAllForks | undefined;
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

  if (closestState === undefined) {
    throw new Error("No closest state found for cp " + toCheckpointKey(cp));
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
