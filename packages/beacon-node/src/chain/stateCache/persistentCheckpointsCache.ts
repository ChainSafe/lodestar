import {fromHexString, toHexString} from "@chainsafe/ssz";
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
 * An implementation of CheckpointStateCache that keep up to n epoch checkpoint states in memory and persist the rest to disk
 * - If it's more than `maxEpochsInMemory` epochs old, it will persist n last epochs to disk based on the view of the block
 * - Once a chain gets finalized we'll prune all states from memory and disk for epochs < finalizedEpoch
 * - In get*() apis if shouldReload is true, it will reload from disk. The reload() api is expensive and should only be called in some important flows:
 *   - Get state for block processing
 *   - updateHeadState
 *   - as with any cache, the state could be evicted from memory at any time, so we should always check if the state is in memory or not
 * - Each time we process a state, we only persist exactly 1 checkpoint state per epoch based on the view of block and prune all others. The persisted
 * checkpoint state could be finalized and used later in archive task, it's also used to regen states.
 * - When we process multiple states in the same epoch, we could persist different checkpoint states of the same epoch because each block could have its
 * own view. See unit test of this file `packages/beacon-node/test/unit/chain/stateCache/persistentCheckpointsCache.test.ts` for more details.
 *
 * The below diagram shows Previous Root Checkpoint State is persisted for epoch (n-2) and Current Root Checkpoint State is persisted for epoch (n-1)
 * while at epoch (n) and (n+1) we have both of them in memory
 *
 * ╔════════════════════════════════════╗═══════════════╗
 * ║      persisted to db or fs         ║   in memory   ║
 * ║        reload if needed            ║               ║
 * ║ -----------------------------------║---------------║
 * ║        epoch:       (n-2)   (n-1)  ║  n     (n+1)  ║
 * ║               |-------|-------|----║--|-------|----║
 * ║                      ^        ^    ║ ^       ^     ║
 * ║                                    ║  ^       ^    ║
 * ╚════════════════════════════════════╝═══════════════╝
 *
 * The "in memory" checkpoint states are similar to the old implementation: we have both Previous Root Checkpoint State and Current Root Checkpoint State per epoch.
 * However in the "persisted to db or fs" part, we usually only persist 1 checkpoint state per epoch, the one that could potentially be justified/finalized later
 * based on the view of blocks.
 */
export class PersistentCheckpointStateCache implements CheckpointStateCache {
  private readonly cache: MapTracker<CheckpointKey, CachedBeaconStateAllForks | PersistentKey>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new MapDef<Epoch, Set<RootHex>>(() => new Set<string>());
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
            persistentEpochs.add(epoch);
          } else {
            stateCount++;
            memoryEpochs.add(epoch);
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
  }

  /**
   * Reload checkpoint state keys from the last run.
   */
  async init(): Promise<void> {
    const persistentKeys = await this.persistentApis.readKeys();
    for (const persistentKey of persistentKeys) {
      const cp = this.persistentApis.persistentKeyToCheckpoint(persistentKey);
      this.cache.set(toCheckpointKey(cp), persistentKey);
    }
  }

  /**
   * Get a state from cache, it may reload from disk.
   * This is an expensive api, should only be called in some important flows:
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

    const logMeta = {persistentKey: toHexString(persistentKey)};

    // reload from disk or db based on closest checkpoint
    this.logger.verbose("Reload: read state", logMeta);
    const newStateBytes = await this.persistentApis.read(persistentKey);
    if (newStateBytes === null) {
      this.logger.verbose("Reload: read state failed", logMeta);
      return null;
    }
    this.logger.verbose("Reload: read state successfully", logMeta);
    this.metrics?.stateRemoveCount.inc({reason: RemovePersistedStateReason.reload});
    this.metrics?.stateReloadSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
    const closestState = findClosestCheckpointState(cp, this.cache) ?? this.getHeadState?.();
    if (closestState == null) {
      throw new Error("No closest state found for cp " + toCheckpointKey(cp));
    }
    this.metrics?.stateReloadEpochDiff.observe(Math.abs(closestState.epochCtx.epoch - cp.epoch));
    this.logger.verbose("Reload: found closest state", {...logMeta, seedSlot: closestState.slot});
    const timer = this.metrics?.stateReloadDuration.startTimer();

    try {
      const newCachedState = loadCachedBeaconState(closestState, newStateBytes, {
        shufflingGetter: this.shufflingCache.getSync.bind(this.shufflingCache),
      });
      timer?.();
      this.logger.verbose("Reload state successfully", {
        ...logMeta,
        stateSlot: newCachedState.slot,
        seedSlot: closestState.slot,
      });
      // only remove persisted state once we reload successfully
      void this.persistentApis.remove(persistentKey);
      this.cache.set(cpKey, newCachedState);
      // don't prune from memory here, call it at the last 1/3 of slot 0 of an epoch
      return newCachedState;
    } catch (e) {
      this.logger.debug("Error reloading state from disk", logMeta, e as Error);
      return null;
    }
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

  /**
   * This is just to conform to the old implementation
   */
  prune(): void {
    // do nothing
  }

  /**
   * Prune all checkpoint states before the provided finalized epoch.
   */
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
   * After processing a block, prune from memory based on the view of that block.
   * This is likely persist 1 state per epoch, at the last 1/3 of slot 0 of an epoch although it'll be called on every last 1/3 of slot.
   * Given the following block b was processed with b2, b1, b0 are ancestors in epoch (n-2), (n-1), n respectively
   *
   *       epoch:          (n-2)       (n-1)         n         (n+1)
   *             |-----------|-----------|-----------|-----------|
   *                        ^            ^           ^    ^
   *                        |            |           |    |
   * block chain:           b2---------->b1--------->b0-->b
   *
   * After processing block b, if maxEpochsInMemory is:
   * - 2 then we'll persist {root: b2, epoch n-2} checkpoint state to disk
   * - 1 then we'll persist {root: b2, epoch n-2} and {root: b1, epoch n-1} checkpoint state to disk
   * - 0 then we'll persist {root: b2, epoch n-2} and {root: b1, epoch n-1} and {root: b0, epoch n} checkpoint state to disk
   *   - if any old epochs checkpoint states are persisted, no need to do it again
   *
   * Note that for each epoch there could be multiple checkpoint states, usually 2, one for Previous Root Checkpoint State and one for Current Root Checkpoint State.
   * We normally only persist 1 checkpoint state per epoch, the one that could potentially be justified/finalized later based on the view of the block.
   * Other checkpoint states are pruned from memory.
   *
   * This design also covers the reorg scenario. Given block c in the same epoch n where c.slot > b.slot, c is not descendant of b, and c is built on top of c0
   * instead of b0 (epoch (n - 1))
   *
   *       epoch:          (n-2)       (n-1)         n         (n+1)
   *             |-----------|-----------|-----------|-----------|
   *                        ^            ^       ^   ^    ^   ^
   *                        |            |       |   |    |   |
   * block chain:           b2---------->b1----->c0->b0-->b   |
   *                                             ║            |
   *                                             ╚═══════════>c (reorg)
   *
   * After processing block c, if maxEpochsInMemory is:
   * - 0 then we'll persist {root: c0, epoch: n} checkpoint state to disk. Note that regen should populate {root: c0, epoch: n} checkpoint state before.
   *
   *                           epoch:      (n-1)                                                           n                                                           (n+1)
   *                                         |-------------------------------------------------------------|-------------------------------------------------------------|
   *                                         ^                               ^                             ^                             ^
   *   _______                               |                               |                             |                             |
   *  |       |                              |                               |                             |                             |
   *  |  db   |====== reload ======> {root: b1, epoch: n-1} cp state ======> c0 block state ======> {root: c0, epoch: n} cp state =====> c block state
   *  |_______|
   *
   *
   *
   * - 1 then we'll persist {root: b1, epoch n-1} checkpoint state to disk. Note that at epoch n there is both {root: b0, epoch: n} and {root: c0, epoch: n} checkpoint states in memory
   * - 2 then we'll persist {root: b2, epoch n-2} checkpoint state to disk, there are also 2 checkpoint states in memory at epoch n, same to the above (maxEpochsInMemory=1)
   *
   * As of Nov 2023, it takes 1.3s to 1.5s to persist a state on holesky on fast server. TODO:
   * - improve state serialization time
   * - or research how to only store diff against the finalized state
   */
  async processState(blockRootHex: RootHex, state: CachedBeaconStateAllForks): Promise<number> {
    let persistCount = 0;
    // it's important to sort the epochs in ascending order, in case of big reorg we always want to keep the most recent checkpoint states
    const sortedEpochs = Array.from(this.epochIndex.keys()).sort((a, b) => a - b);
    while (sortedEpochs.length > this.maxEpochsInMemory) {
      const lowestEpoch = sortedEpochs.shift();
      if (lowestEpoch === undefined) {
        // should not happen
        throw new Error("No epoch in memory");
      }
      const epochBoundarySlot = computeStartSlotAtEpoch(lowestEpoch);
      const epochBoundaryRoot =
        epochBoundarySlot === state.slot ? fromHexString(blockRootHex) : getBlockRootAtSlot(state, epochBoundarySlot);
      const rootHexPersist = toHexString(epochBoundaryRoot);
      // for each epoch, usually there are 2 rootHex respective to the 2 checkpoint states: Previous Root Checkpoint State and Current Root Checkpoint State
      for (const rootHex of this.epochIndex.get(lowestEpoch) ?? []) {
        const cpKey = toCheckpointKey({epoch: lowestEpoch, rootHex});
        const stateOrPersistentKey = this.cache.get(cpKey);
        if (stateOrPersistentKey !== undefined && !isPersistentKey(stateOrPersistentKey)) {
          // this is state in memory, we don't care if the checkpoint state is already persisted
          if (rootHex === rootHexPersist) {
            // persist
            // do not update epochIndex
            this.metrics?.statePersistSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
            const timer = this.metrics?.statePersistDuration.startTimer();
            const cpPersist = {epoch: lowestEpoch, root: epochBoundaryRoot};
            const persistentKey = await this.persistentApis.write(cpPersist, stateOrPersistentKey);
            timer?.();
            // overwrite cpKey, this means the state is deleted from memory
            this.cache.set(cpKey, persistentKey);
            persistCount++;
            this.logger.verbose("Prune checkpoint state from memory and persist to disk", {
              persistentKey: toHexString(persistentKey),
              stateSlot: stateOrPersistentKey.slot,
              rootHex,
            });
          } else {
            // delete the state from memory
            this.epochIndex.get(lowestEpoch)?.delete(rootHex);
            this.cache.delete(cpKey);
            this.metrics?.statePruneFromMemoryCount.inc();
            this.logger.verbose("Prune checkpoint state from memory", {stateSlot: stateOrPersistentKey.slot, rootHex});
          }
        }
      }
    }

    return persistCount;
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

  /**
   * Delete all items of an epoch from disk and memory
   */
  private async deleteAllEpochItems(epoch: Epoch): Promise<void> {
    for (const rootHex of this.epochIndex.get(epoch) || []) {
      const key = toCheckpointKey({rootHex, epoch});
      const stateOrPersistentKey = this.cache.get(key);
      if (stateOrPersistentKey !== undefined && isPersistentKey(stateOrPersistentKey)) {
        await this.persistentApis.remove(stateOrPersistentKey);
        this.metrics?.stateRemoveCount.inc({reason: RemovePersistedStateReason.pruneFinalized});
      }
      this.cache.delete(key);
    }
    this.epochIndex.delete(epoch);
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

export function toCheckpointKey(cp: CheckpointHex | phase0.Checkpoint): CheckpointKey {
  if (isCheckpointHex(cp)) {
    return `${cp.rootHex}_${cp.epoch}`;
  }
  return `${toHexString(cp.root)}_${cp.epoch}`;
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

function isCheckpointHex(cp: CheckpointHex | phase0.Checkpoint): cp is CheckpointHex {
  return (cp as CheckpointHex).rootHex !== undefined;
}
