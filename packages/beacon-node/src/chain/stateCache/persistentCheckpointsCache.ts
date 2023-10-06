import {toHexString} from "@chainsafe/ssz";
import {phase0, Epoch, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch, getBlockRootAtSlot} from "@lodestar/state-transition";
import {Logger, MapDef} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {loadCachedBeaconState} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {ShufflingCache} from "../shufflingCache.js";
import {MapTracker} from "./mapMetrics.js";
import {
  CacheType,
  CheckpointHex,
  PersistentCheckpointStateCacheModules,
  PersistentCheckpointStateCacheOpts,
  GetHeadStateFn,
  RemovePersistedStateReason,
  CheckpointStateCache,
  CheckpointKey,
} from "./types.js";
import {CPStatePersistentApis, PersistentKey} from "./persistent/types.js";

/**
 * Cache of CachedBeaconState belonging to checkpoint
 * - If it's more than MAX_STATES_IN_MEMORY epochs old, it will be persisted to disk following LRU cache
 * - Once a chain gets finalized we'll prune all states from memory and disk for epochs < finalizedEpoch
 * - In get*() apis if shouldReload is true, it will reload from disk
 *
 * Similar API to Repository
 */
export class PersistentCheckpointStateCache implements CheckpointStateCache {
  private readonly cache: MapTracker<string, CachedBeaconStateAllForks | PersistentKey>;
  // maintain order of epoch to decide which epoch to prune from memory
  private readonly inMemoryEpochs: Set<Epoch>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new MapDef<Epoch, Set<string>>(() => new Set<string>());
  private readonly metrics: Metrics["cpStateCache"] | null | undefined;
  private readonly logger: Logger;
  private readonly clock: IClock | null | undefined;
  private preComputedCheckpoint: string | null = null;
  private preComputedCheckpointHits: number | null = null;
  private readonly maxEpochsInMemory: number;
  private readonly persistentApis: CPStatePersistentApis;
  private readonly shufflingCache: ShufflingCache;
  private readonly getHeadState?: GetHeadStateFn;

  constructor(
    {metrics, logger, clock, shufflingCache, persistentApis, getHeadState}: PersistentCheckpointStateCacheModules,
    opts: PersistentCheckpointStateCacheOpts
  ) {
    this.cache = new MapTracker(metrics?.cpStateCache);
    if (metrics) {
      this.metrics = metrics.cpStateCache;
      metrics.cpStateCache.size.addCollect(() => {
        let persistCount = 0;
        let stateCount = 0;
        const memoryEpochs = new Set<Epoch>();
        const persistentEpochs = new Set<Epoch>();
        for (const [key, stateOrPersistentKey] of this.cache.entries()) {
          const {epoch} = fromCheckpointKey(key);
          if (isPersistentKey(stateOrPersistentKey)) {
            persistCount++;
            memoryEpochs.add(epoch);
          } else {
            stateCount++;
            persistentEpochs.add(epoch);
          }
        }
        metrics.cpStateCache.size.set({type: CacheType.persistence}, persistCount);
        metrics.cpStateCache.size.set({type: CacheType.state}, stateCount);
        metrics.cpStateCache.epochSize.set({type: CacheType.persistence}, persistentEpochs.size);
        metrics.cpStateCache.epochSize.set({type: CacheType.state}, memoryEpochs.size);
      });
    }
    this.logger = logger;
    this.clock = clock;
    if (opts.maxEpochsInMemory < 0) {
      throw new Error("maxEpochsInMemory must be >= 0");
    }
    this.maxEpochsInMemory = opts.maxEpochsInMemory;
    // Specify different persistentApis for testing
    this.persistentApis = persistentApis;
    this.shufflingCache = shufflingCache;
    this.getHeadState = getHeadState;
    this.inMemoryEpochs = new Set();
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

    const persistentKey = this.cache.get(cpKey);
    if (persistentKey === undefined) {
      return null;
    }

    if (!isPersistentKey(persistentKey)) {
      // should not happen, in-memory state is handled above
      throw new Error("Expected persistent key");
    }

    // reload from disk or db based on closest checkpoint
    this.logger.verbose("Reload: read state", {persistentKey});
    const newStateBytes = await this.persistentApis.read(persistentKey);
    if (newStateBytes === null) {
      this.logger.verbose("Reload: read state failed", {persistentKey});
      return null;
    }
    this.logger.verbose("Reload: read state successfully", {persistentKey});
    this.metrics?.stateRemoveCount.inc({reason: RemovePersistedStateReason.reload});
    this.metrics?.stateReloadSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
    const closestState = findClosestCheckpointState(cp, this.cache) ?? this.getHeadState?.();
    if (closestState == null) {
      throw new Error("No closest state found for cp " + toCheckpointKey(cp));
    }
    this.metrics?.stateReloadEpochDiff.observe(Math.abs(closestState.epochCtx.epoch - cp.epoch));
    this.logger.verbose("Reload: found closest state", {persistentKey, seedSlot: closestState.slot});
    const timer = this.metrics?.stateReloadDuration.startTimer();

    try {
      const newCachedState = loadCachedBeaconState(closestState, newStateBytes, {
        shufflingGetter: this.shufflingCache.get.bind(this.shufflingCache),
      });
      timer?.();
      this.logger.verbose("Reload state successfully", {
        persistentKey,
        stateSlot: newCachedState.slot,
        seedSlot: closestState.slot,
      });
      // only remove persisted state once we reload successfully
      void this.persistentApis.remove(persistentKey);
      this.cache.set(cpKey, newCachedState);
      this.inMemoryEpochs.add(cp.epoch);
      // don't prune from memory here, call it at the last 1/3 of slot 0 of an epoch
      return newCachedState;
    } catch (e) {
      this.logger.debug("Error reloading state from disk", {persistentKey}, e as Error);
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

    const persistentKey = this.cache.get(cpKey);
    if (persistentKey === undefined) {
      return null;
    }

    if (!isPersistentKey(persistentKey)) {
      // should not happen, in-memory state is handled above
      throw new Error("Expected persistent key");
    }

    return this.persistentApis.read(persistentKey);
  }

  /**
   * Similar to get() api without reloading from disk
   */
  get(cpOrKey: CheckpointHex | string): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const cpKey = typeof cpOrKey === "string" ? cpOrKey : toCheckpointKey(cpOrKey);
    const stateOrPersistentKey = this.cache.get(cpKey);

    if (stateOrPersistentKey === undefined) {
      return null;
    }

    this.metrics?.hits.inc();

    if (cpKey === this.preComputedCheckpoint) {
      this.preComputedCheckpointHits = (this.preComputedCheckpointHits ?? 0) + 1;
    }

    if (!isPersistentKey(stateOrPersistentKey)) {
      this.metrics?.stateClonedCount.observe(stateOrPersistentKey.clonedCount);
      return stateOrPersistentKey;
    }

    return null;
  }

  /**
   * Add a state of a checkpoint to this cache, prune from memory if necessary.
   */
  add(cp: phase0.Checkpoint, state: CachedBeaconStateAllForks): void {
    const cpHex = toCheckpointHex(cp);
    const key = toCheckpointKey(cpHex);
    const stateOrPersistentKey = this.cache.get(key);
    this.inMemoryEpochs.add(cp.epoch);
    if (stateOrPersistentKey !== undefined) {
      if (isPersistentKey(stateOrPersistentKey)) {
        // was persisted to disk, set back to memory
        this.cache.set(key, state);
        void this.persistentApis.remove(stateOrPersistentKey);
        this.metrics?.stateRemoveCount.inc({reason: RemovePersistedStateReason.stateUpdate});
      }
      return;
    }
    this.metrics?.adds.inc();
    this.cache.set(key, state);
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
        this.deleteAllEpochItems(epoch).catch((e) =>
          this.logger.debug("Error delete all epoch items", {epoch, finalizedEpoch}, e as Error)
        );
      }
    }
  }

  /**
   * For testing only
   */
  delete(cp: phase0.Checkpoint): void {
    const key = toCheckpointKey(toCheckpointHex(cp));
    this.cache.delete(key);
    // check if there's any state left in memory for this epoch
    let foundState = false;
    for (const rootHex of this.epochIndex.get(cp.epoch)?.values() || []) {
      const cpKey = toCheckpointKey({epoch: cp.epoch, rootHex});
      const stateOrPersistentKey = this.cache.get(cpKey);
      if (stateOrPersistentKey !== undefined && !isPersistentKey(stateOrPersistentKey)) {
        // this is a state
        foundState = true;
        break;
      }
    }
    if (!foundState) {
      this.inMemoryEpochs.delete(cp.epoch);
    }
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
  async deleteAllEpochItems(epoch: Epoch): Promise<void> {
    for (const rootHex of this.epochIndex.get(epoch) || []) {
      const key = toCheckpointKey({rootHex, epoch});
      const stateOrPersistentKey = this.cache.get(key);
      if (stateOrPersistentKey !== undefined && isPersistentKey(stateOrPersistentKey)) {
        await this.persistentApis.remove(stateOrPersistentKey);
        this.metrics?.stateRemoveCount.inc({reason: RemovePersistedStateReason.pruneFinalized});
      }
      this.cache.delete(key);
    }
    this.inMemoryEpochs.delete(epoch);
    this.epochIndex.delete(epoch);
  }

  /**
   * This is slow code because it involves serializing the whole state to disk which takes 600ms to 900ms as of Sep 2023
   * The add() is called after we process 1st block of an epoch, we don't want to pruneFromMemory at that time since it's the hot time
   * Call this code at the last 1/3 slot of slot 0 of an epoch
   */
  async pruneFromMemory(): Promise<number> {
    let count = 0;
    while (this.inMemoryEpochs.size > this.maxEpochsInMemory) {
      let firstEpoch: Epoch | undefined;
      for (const epoch of this.inMemoryEpochs) {
        firstEpoch = epoch;
        break;
      }
      if (firstEpoch === undefined) {
        // should not happen
        throw new Error("No epoch in memory");
      }
      // first loop to check if the 1st slot of epoch is a skipped slot or not
      let firstSlotBlockRoot: string | undefined;
      for (const rootHex of this.epochIndex.get(firstEpoch) ?? []) {
        const cpKey = toCheckpointKey({epoch: firstEpoch, rootHex});
        const stateOrPersistentKey = this.cache.get(cpKey);
        if (stateOrPersistentKey !== undefined && !isPersistentKey(stateOrPersistentKey)) {
          // this is a state
          if (
            rootHex !== toHexString(getBlockRootAtSlot(stateOrPersistentKey, computeStartSlotAtEpoch(firstEpoch) - 1))
          ) {
            firstSlotBlockRoot = rootHex;
            break;
          }
        }
      }

      // if found firstSlotBlockRoot it means it's a checkpoint state and we should only persist that checkpoint, delete the other
      // if not found firstSlotBlockRoot, first slot of state is skipped, we should persist the other checkpoint state, with the root is the last slot of pervious epoch
      for (const rootHex of this.epochIndex.get(firstEpoch) ?? []) {
        let toPersist = false;
        let toDelete = false;
        if (firstSlotBlockRoot === undefined) {
          toPersist = true;
        } else {
          if (rootHex === firstSlotBlockRoot) {
            toPersist = true;
          } else {
            toDelete = true;
          }
        }
        const cpKey = toCheckpointKey({epoch: firstEpoch, rootHex});
        const stateOrPersistentKey = this.cache.get(cpKey);
        if (stateOrPersistentKey !== undefined && !isPersistentKey(stateOrPersistentKey)) {
          if (toPersist) {
            // do not update epochIndex
            this.metrics?.statePersistSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
            const timer = this.metrics?.statePersistDuration.startTimer();
            const persistentKey = await this.persistentApis.write(cpKey, stateOrPersistentKey);
            timer?.();
            this.cache.set(cpKey, persistentKey);
            count++;
            this.logger.verbose("Prune checkpoint state from memory and persist to disk", {
              persistentKey,
              stateSlot: stateOrPersistentKey.slot,
              rootHex,
            });
          } else if (toDelete) {
            this.cache.delete(cpKey);
            this.metrics?.statePruneFromMemoryCount.inc();
            this.logger.verbose("Prune checkpoint state from memory", {stateSlot: stateOrPersistentKey.slot, rootHex});
          }
        }
      }

      this.inMemoryEpochs.delete(firstEpoch);
    }

    return count;
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
  }

  /** ONLY FOR DEBUGGING PURPOSES. For lodestar debug API */
  dumpSummary(): routes.lodestar.StateCacheItem[] {
    return Array.from(this.cache.keys()).map((key) => {
      const cp = fromCheckpointKey(key);
      const stateOrPersistentKey = this.cache.get(key);
      return {
        slot: computeStartSlotAtEpoch(cp.epoch),
        root: cp.rootHex,
        reads: this.cache.readCount.get(key) ?? 0,
        lastRead: this.cache.lastRead.get(key) ?? 0,
        checkpointState: true,
        persistentKey:
          stateOrPersistentKey !== undefined && isPersistentKey(stateOrPersistentKey)
            ? stateOrPersistentKey
            : undefined,
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
  cache: Map<string, CachedBeaconStateAllForks | PersistentKey>
): CachedBeaconStateAllForks | null {
  let smallestEpochDiff = Infinity;
  let closestState: CachedBeaconStateAllForks | null = null;
  for (const [key, value] of cache.entries()) {
    // ignore entries with PersistentKey
    if (isPersistentKey(value)) {
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

export function toCheckpointKey(cp: CheckpointHex): CheckpointKey {
  return `${cp.rootHex}_${cp.epoch}`;
}

export function fromCheckpointKey(key: CheckpointKey): CheckpointHex {
  const [rootHex, epoch] = key.split("_");
  return {
    rootHex,
    epoch: Number(epoch),
  };
}

function isPersistentKey(
  stateOrPersistentKey: CachedBeaconStateAllForks | PersistentKey
): stateOrPersistentKey is PersistentKey {
  return (stateOrPersistentKey as CachedBeaconStateAllForks).epochCtx === undefined;
}
