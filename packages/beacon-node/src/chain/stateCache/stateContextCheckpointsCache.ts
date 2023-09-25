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
import {MapTracker} from "./mapMetrics.js";

export type CheckpointHex = {epoch: Epoch; rootHex: RootHex};

// Make this generic to support testing
export type PersistentApis = {
  writeIfNotExist: (filepath: string, bytes: Uint8Array) => Promise<boolean>;
  removeFile: (path: string) => Promise<boolean>;
  readFileSync: (path: string) => Uint8Array;
  ensureDir: (path: string) => Promise<void>;
};

// Default persistent api for a regular node, use other persistent apis for testing
const FILE_APIS: PersistentApis = {
  writeIfNotExist,
  removeFile,
  readFileSync: fs.readFileSync,
  ensureDir,
};

const TMP_STATES_FOLDER = "./tmpStates";

export type StateFile = string;
/**
 * Keep max n states in memory, persist the rest to disk
 */
const MAX_STATES_IN_MEMORY = 2;

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
  private readonly maxStatesInMemory: number;
  private readonly persistentApis: PersistentApis;

  constructor({
    metrics,
    clock,
    maxStatesInMemory,
    persistentApis,
  }: {
    metrics?: Metrics | null;
    clock?: IClock | null;
    maxStatesInMemory?: number;
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
    this.maxStatesInMemory = maxStatesInMemory ?? MAX_STATES_IN_MEMORY;
    // Specify different persistentApis for testing
    this.persistentApis = persistentApis ?? FILE_APIS;
    this.inMemoryKeyOrder = new LinkedList<string>();
    void ensureDir(TMP_STATES_FOLDER);
  }

  /**
   * Get a state from cache, if shouldReload = true, it will reload from disk
   */
  get(cp: CheckpointHex, shouldReload = false): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const cpKey = toCheckpointKey(cp);
    const item = this.cache.get(cpKey);

    if (item === undefined) {
      return null;
    }

    this.metrics?.hits.inc();

    if (cpKey === this.preComputedCheckpoint) {
      this.preComputedCheckpointHits = (this.preComputedCheckpointHits ?? 0) + 1;
    }

    if (typeof item !== "string") {
      this.metrics?.stateClonedCount.observe(item.clonedCount);
      this.inMemoryKeyOrder.moveToHead(cpKey);
      return item;
    }

    if (!shouldReload) {
      return null;
    }

    // reload from disk based on closest checkpoint
    // TODO: use async
    const newStateBytes = this.persistentApis.readFileSync(item);
    void this.persistentApis.removeFile(item);
    this.metrics?.stateFilesRemoveCount.inc({reason: RemoveFileReason.reload});
    this.metrics?.stateReloadSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
    const closestState = findClosestCheckpointState(cp, this.cache);
    this.metrics?.stateReloadEpochDiff.observe(Math.abs(closestState.epochCtx.epoch - cp.epoch));
    const timer = this.metrics?.stateReloadDuration.startTimer();
    const newCachedState = loadCachedBeaconState(closestState, newStateBytes);
    timer?.();
    this.cache.set(cpKey, newCachedState);
    // since item is file path, cpKey is not in inMemoryKeyOrder
    this.inMemoryKeyOrder.unshift(cpKey);
    this.pruneFromMemory();
    return newCachedState;
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
   * Searches for the latest cached state with a `root`, starting with `epoch` and descending
   * TODO: change consumers with this shouldReload flag
   */
  getLatest(rootHex: RootHex, maxEpoch: Epoch, shouldReload = false): CachedBeaconStateAllForks | null {
    // sort epochs in descending order, only consider epochs lte `epoch`
    const epochs = Array.from(this.epochIndex.keys())
      .sort((a, b) => b - a)
      .filter((e) => e <= maxEpoch);
    for (const epoch of epochs) {
      if (this.epochIndex.get(epoch)?.has(rootHex)) {
        return this.get({rootHex, epoch}, shouldReload);
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
    const cpState = this.get({rootHex, epoch});
    if (!cpState) {
      // should not happen
      throw new Error(`Could not find precomputed checkpoint state for ${rootHex} at epoch ${epoch}`);
    }

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
    while (this.inMemoryKeyOrder.length > this.maxStatesInMemory) {
      const key = this.inMemoryKeyOrder.pop();
      if (!key) {
        // should not happen
        throw new Error("No key");
      }
      const stateOrFilePath = this.cache.get(key);
      if (stateOrFilePath !== undefined && typeof stateOrFilePath !== "string") {
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
  return path.join(TMP_STATES_FOLDER, key);
}
