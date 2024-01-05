import {fromHexString, toHexString} from "@chainsafe/ssz";
import {phase0, Epoch, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch, getBlockRootAtSlot} from "@lodestar/state-transition";
import {Logger, MapDef, sleep} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {loadCachedBeaconState} from "@lodestar/state-transition";
import {INTERVALS_PER_SLOT} from "@lodestar/params";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {ShufflingCache} from "../shufflingCache.js";
import {BufferPool} from "../../util/bufferPool.js";
import {MapTracker} from "./mapMetrics.js";
import {CPStateDatastore, DatastoreKey, datastoreKeyToCheckpoint} from "./datastore/index.js";
import {CheckpointHex, CacheItemType, CheckpointStateCache} from "./types.js";

export type PersistentCheckpointStateCacheOpts = {
  // Keep max n states in memory, persist the rest to disk
  maxCPStateEpochsInMemory?: number;
};

type GetHeadStateFn = () => CachedBeaconStateAllForks;

type PersistentCheckpointStateCacheModules = {
  metrics?: Metrics | null;
  logger: Logger;
  clock?: IClock | null;
  signal?: AbortSignal;
  shufflingCache: ShufflingCache;
  datastore: CPStateDatastore;
  getHeadState?: GetHeadStateFn;
  bufferPool?: BufferPool;
};

/** checkpoint serialized as a string */
type CacheKey = string;

type InMemoryCacheItem = {
  type: CacheItemType.inMemory;
  state: CachedBeaconStateAllForks;
  // if a cp state is reloaded from disk, it'll keep track of persistedKey to allow us to remove it from disk later
  // it also helps not to persist it again
  persistedKey?: DatastoreKey;
};

type PersistedCacheItem = {
  type: CacheItemType.persisted;
  value: DatastoreKey;
};

type CacheItem = InMemoryCacheItem | PersistedCacheItem;

type LoadedStateBytesData = {persistedKey: DatastoreKey; stateBytes: Uint8Array};

/**
 * Before n-historical states, lodestar keeps mostly 3 states in memory with 1 finalized state
 * Since Jan 2024, lodestar stores the finalized state in disk and keeps up to 2 epochs in memory
 */
export const DEFAULT_MAX_CP_STATE_EPOCHS_IN_MEMORY = 2;

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
  private readonly cache: MapTracker<CacheKey, CacheItem>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new MapDef<Epoch, Set<RootHex>>(() => new Set<string>());
  private readonly metrics: Metrics["cpStateCache"] | null | undefined;
  private readonly logger: Logger;
  private readonly clock: IClock | null | undefined;
  private readonly signal: AbortSignal | undefined;
  private preComputedCheckpoint: string | null = null;
  private preComputedCheckpointHits: number | null = null;
  private readonly maxEpochsInMemory: number;
  private readonly datastore: CPStateDatastore;
  private readonly shufflingCache: ShufflingCache;
  private readonly getHeadState?: GetHeadStateFn;
  private readonly bufferPool?: BufferPool;

  constructor(
    {
      metrics,
      logger,
      clock,
      signal,
      shufflingCache,
      datastore,
      getHeadState,
      bufferPool,
    }: PersistentCheckpointStateCacheModules,
    opts: PersistentCheckpointStateCacheOpts
  ) {
    this.cache = new MapTracker(metrics?.cpStateCache);
    if (metrics) {
      this.metrics = metrics.cpStateCache;
      metrics.cpStateCache.size.addCollect(() => {
        let persistCount = 0;
        let inMemoryCount = 0;
        const memoryEpochs = new Set<Epoch>();
        const persistentEpochs = new Set<Epoch>();
        for (const [key, cacheItem] of this.cache.entries()) {
          const {epoch} = fromCacheKey(key);
          if (isPersistedCacheItem(cacheItem)) {
            persistCount++;
            persistentEpochs.add(epoch);
          } else {
            inMemoryCount++;
            memoryEpochs.add(epoch);
          }
        }
        metrics.cpStateCache.size.set({type: CacheItemType.persisted}, persistCount);
        metrics.cpStateCache.size.set({type: CacheItemType.inMemory}, inMemoryCount);
        metrics.cpStateCache.epochSize.set({type: CacheItemType.persisted}, persistentEpochs.size);
        metrics.cpStateCache.epochSize.set({type: CacheItemType.inMemory}, memoryEpochs.size);
      });
    }
    this.logger = logger;
    this.clock = clock;
    this.signal = signal;
    if (opts.maxCPStateEpochsInMemory !== undefined && opts.maxCPStateEpochsInMemory < 0) {
      throw new Error("maxEpochsInMemory must be >= 0");
    }
    this.maxEpochsInMemory = opts.maxCPStateEpochsInMemory ?? DEFAULT_MAX_CP_STATE_EPOCHS_IN_MEMORY;
    // Specify different datastore for testing
    this.datastore = datastore;
    this.shufflingCache = shufflingCache;
    this.getHeadState = getHeadState;
    this.bufferPool = bufferPool;
  }

  /**
   * Reload checkpoint state keys from the last run.
   */
  async init(): Promise<void> {
    const persistedKeys = await this.datastore.readKeys();
    for (const persistedKey of persistedKeys) {
      const cp = datastoreKeyToCheckpoint(persistedKey);
      this.cache.set(toCacheKey(cp), {type: CacheItemType.persisted, value: persistedKey});
      this.epochIndex.getOrDefault(cp.epoch).add(toHexString(cp.root));
    }
    this.logger.info("Loaded persisted checkpoint states from the last run", {
      count: persistedKeys.length,
      maxEpochsInMemory: this.maxEpochsInMemory,
    });
  }

  /**
   * Get a state from cache, it may reload from disk.
   * This is an expensive api, should only be called in some important flows:
   * - Validate a gossip block
   * - Get block for processing
   * - Regen head state
   */
  async getOrReload(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | null> {
    const stateOrStateBytesData = await this.getStateOrLoadDb(cp);
    if (stateOrStateBytesData === null || isCachedBeaconState(stateOrStateBytesData)) {
      return stateOrStateBytesData;
    }
    const {persistedKey, stateBytes} = stateOrStateBytesData;
    const logMeta = {persistedKey: toHexString(persistedKey)};
    this.logger.debug("Reload: read state successful", logMeta);
    this.metrics?.stateReloadSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
    const seedState = this.findSeedStateToReload(cp) ?? this.getHeadState?.();
    if (seedState == null) {
      throw new Error("No seed state found for cp " + toCacheKey(cp));
    }
    this.metrics?.stateReloadEpochDiff.observe(Math.abs(seedState.epochCtx.epoch - cp.epoch));
    this.logger.debug("Reload: found seed state", {...logMeta, seedSlot: seedState.slot});

    try {
      const validatorsSszTimer = this.metrics?.stateReloadValidatorsSszDuration.startTimer();
      // 80% of validators serialization time comes from memory allocation, this is to avoid it
      const seedValidatorsBytes = this.serializeStateValidators(seedState);
      validatorsSszTimer?.();
      const reloadTimer = this.metrics?.stateReloadDuration.startTimer();
      const newCachedState = loadCachedBeaconState(
        seedState,
        stateBytes,
        {
          shufflingGetter: (shufflingEpoch, decisionRootHex) => {
            const shuffling = this.shufflingCache.getSync(shufflingEpoch, decisionRootHex);
            if (shuffling == null) {
              this.metrics?.stateReloadShufflingCacheMiss.inc();
            }
            return shuffling;
          },
        },
        seedValidatorsBytes
      );
      newCachedState.commit();
      const stateRoot = toHexString(newCachedState.hashTreeRoot());
      reloadTimer?.();
      this.logger.debug("Reload: cached state load successful", {
        ...logMeta,
        stateSlot: newCachedState.slot,
        stateRoot,
        seedSlot: seedState.slot,
      });

      // only remove persisted state once we reload successfully
      const cpKey = toCacheKey(cp);
      this.cache.set(cpKey, {type: CacheItemType.inMemory, state: newCachedState, persistedKey});
      this.epochIndex.getOrDefault(cp.epoch).add(cp.rootHex);
      // don't prune from memory here, call it at the last 1/3 of slot 0 of an epoch
      return newCachedState;
    } catch (e) {
      this.logger.debug("Reload: error loading cached state", logMeta, e as Error);
      return null;
    }
  }

  /**
   * Return either state or state bytes loaded from db.
   */
  async getStateOrBytes(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | Uint8Array | null> {
    const stateOrLoadedState = await this.getStateOrLoadDb(cp);
    if (stateOrLoadedState === null || isCachedBeaconState(stateOrLoadedState)) {
      return stateOrLoadedState;
    }
    return stateOrLoadedState.stateBytes;
  }

  /**
   * Return either state or state bytes with persisted key loaded from db.
   */
  async getStateOrLoadDb(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | LoadedStateBytesData | null> {
    const cpKey = toCacheKey(cp);
    const inMemoryState = this.get(cpKey);
    if (inMemoryState) {
      return inMemoryState;
    }

    const cacheItem = this.cache.get(cpKey);
    if (cacheItem === undefined) {
      return null;
    }

    if (isInMemoryCacheItem(cacheItem)) {
      // should not happen, in-memory state is handled above
      throw new Error("Expected persistent key");
    }

    const persistedKey = cacheItem.value;
    const dbReadTimer = this.metrics?.stateReloadDbReadTime.startTimer();
    const stateBytes = await this.datastore.read(persistedKey);
    dbReadTimer?.();

    if (stateBytes === null) {
      return null;
    }
    return {persistedKey, stateBytes};
  }

  /**
   * Similar to get() api without reloading from disk
   */
  get(cpOrKey: CheckpointHex | string): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const cpKey = typeof cpOrKey === "string" ? cpOrKey : toCacheKey(cpOrKey);
    const cacheItem = this.cache.get(cpKey);

    if (cacheItem === undefined) {
      return null;
    }

    this.metrics?.hits.inc();

    if (cpKey === this.preComputedCheckpoint) {
      this.preComputedCheckpointHits = (this.preComputedCheckpointHits ?? 0) + 1;
    }

    if (isInMemoryCacheItem(cacheItem)) {
      const {state} = cacheItem;
      this.metrics?.stateClonedCount.observe(state.clonedCount);
      return state;
    }

    return null;
  }

  /**
   * Add a state of a checkpoint to this cache, prune from memory if necessary.
   */
  add(cp: phase0.Checkpoint, state: CachedBeaconStateAllForks): void {
    const cpHex = toCheckpointHex(cp);
    const key = toCacheKey(cpHex);
    const cacheItem = this.cache.get(key);
    this.metrics?.adds.inc();
    if (cacheItem !== undefined && isPersistedCacheItem(cacheItem)) {
      const persistedKey = cacheItem.value;
      // was persisted to disk, set back to memory
      this.cache.set(key, {type: CacheItemType.inMemory, state, persistedKey});
      this.logger.verbose("Added checkpoint state to memory but a persisted key existed", {
        epoch: cp.epoch,
        rootHex: cpHex.rootHex,
        persistedKey: toHexString(persistedKey),
      });
    } else {
      this.cache.set(key, {type: CacheItemType.inMemory, state});
      this.logger.verbose("Added checkpoint state to memory", {epoch: cp.epoch, rootHex: cpHex.rootHex});
    }
    this.epochIndex.getOrDefault(cp.epoch).add(cpHex.rootHex);
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
    this.preComputedCheckpoint = toCacheKey({rootHex, epoch});
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
   * As of Jan 2024, it takes 1.2s to persist a holesky state on fast server. TODO:
   * - improve state serialization time
   * - or research how to only store diff against the finalized state
   */
  async processState(blockRootHex: RootHex, state: CachedBeaconStateAllForks): Promise<number> {
    let persistCount = 0;
    // it's important to sort the epochs in ascending order, in case of big reorg we always want to keep the most recent checkpoint states
    const sortedEpochs = Array.from(this.epochIndex.keys()).sort((a, b) => a - b);
    if (sortedEpochs.length <= this.maxEpochsInMemory) {
      return 0;
    }

    const blockSlot = state.slot;
    const twoThirdsSlot = (2 * state.config.SECONDS_PER_SLOT) / INTERVALS_PER_SLOT;
    // we always have clock in production, fallback value is only for test
    const secFromSlot = this.clock?.secFromSlot(blockSlot) ?? twoThirdsSlot;
    const secToTwoThirdsSlot = twoThirdsSlot - secFromSlot;
    if (secToTwoThirdsSlot > 0) {
      // 2/3 of slot is the most free time of every slot, take that chance to persist checkpoint states
      // normally it should only persist checkpoint states at 2/3 of slot 0 of epoch
      await sleep(secToTwoThirdsSlot * 1000, this.signal);
    } else {
      // normally the block persist happens at 2/3 of slot 0 of epoch, if it's already late then just skip to allow other tasks to run
      // there are plenty of chances in the same epoch to persist checkpoint states, also if block is late it could be reorged
      this.logger.verbose("Skip persist checkpoint states", {blockSlot, root: blockRootHex});
      return 0;
    }

    const persistEpochs = sortedEpochs.slice(0, sortedEpochs.length - this.maxEpochsInMemory);
    for (const lowestEpoch of persistEpochs) {
      // usually there is only 0 or 1 epoch to persist in this loop
      persistCount += await this.processPastEpoch(blockRootHex, state, lowestEpoch);
    }

    if (persistCount > 0) {
      this.logger.verbose("Persisted checkpoint states", {
        slot: blockSlot,
        root: blockRootHex,
        persistCount,
        persistEpochs: persistEpochs.length,
      });
    }
    return persistCount;
  }

  /**
   * Find a seed state to reload the state of provided checkpoint. Based on the design of n-historical state:
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
   * we always reload an epoch in the past. We'll start with epoch n then (n+1) prioritizing ones with the same view of `reloadedCp`.
   *
   * This could return null and we should get head state in that case.
   */
  findSeedStateToReload(reloadedCp: CheckpointHex): CachedBeaconStateAllForks | null {
    const maxEpoch = Math.max(...Array.from(this.epochIndex.keys()));
    const reloadedCpSlot = computeStartSlotAtEpoch(reloadedCp.epoch);
    let firstState: CachedBeaconStateAllForks | null = null;
    // no need to check epochs before `maxEpoch - this.maxEpochsInMemory + 1` before they are all persisted
    for (let epoch = maxEpoch - this.maxEpochsInMemory + 1; epoch <= maxEpoch; epoch++) {
      // if there's at least 1 state in memory in an epoch, just return the 1st one
      if (firstState !== null) {
        return firstState;
      }

      for (const rootHex of this.epochIndex.get(epoch) || []) {
        const cpKey = toCacheKey({rootHex, epoch});
        const cacheItem = this.cache.get(cpKey);
        if (cacheItem === undefined) {
          // should not happen
          continue;
        }
        if (isInMemoryCacheItem(cacheItem)) {
          const {state} = cacheItem;
          if (firstState === null) {
            firstState = state;
          }

          // amongst states of the same epoch, choose the one with the same view of reloadedCp
          if (
            reloadedCpSlot < state.slot &&
            toHexString(getBlockRootAtSlot(state, reloadedCpSlot)) === reloadedCp.rootHex
          ) {
            return state;
          }
        }
      }
    }

    return firstState;
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
  }

  /** ONLY FOR DEBUGGING PURPOSES. For lodestar debug API */
  dumpSummary(): routes.lodestar.StateCacheItem[] {
    return Array.from(this.cache.keys()).map((key) => {
      const cp = fromCacheKey(key);
      // TODO: add checkpoint key and persistent key to the summary
      return {
        slot: computeStartSlotAtEpoch(cp.epoch),
        root: cp.rootHex,
        reads: this.cache.readCount.get(key) ?? 0,
        lastRead: this.cache.lastRead.get(key) ?? 0,
        checkpointState: true,
      };
    });
  }

  /** ONLY FOR DEBUGGING PURPOSES. For spec tests on error */
  dumpCheckpointKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  private async processPastEpoch(
    blockRootHex: RootHex,
    state: CachedBeaconStateAllForks,
    epoch: Epoch
  ): Promise<number> {
    let persistCount = 0;
    const epochBoundarySlot = computeStartSlotAtEpoch(epoch);
    const epochBoundaryRoot =
      epochBoundarySlot === state.slot ? fromHexString(blockRootHex) : getBlockRootAtSlot(state, epochBoundarySlot);
    const epochBoundaryHex = toHexString(epochBoundaryRoot);

    // for each epoch, usually there are 2 rootHex respective to the 2 checkpoint states: Previous Root Checkpoint State and Current Root Checkpoint State
    for (const rootHex of this.epochIndex.get(epoch) ?? []) {
      const cpKey = toCacheKey({epoch: epoch, rootHex});
      const cacheItem = this.cache.get(cpKey);

      if (cacheItem !== undefined && isInMemoryCacheItem(cacheItem)) {
        // this is state in memory, we don't care if the checkpoint state is already persisted
        let {persistedKey} = cacheItem;
        const {state} = cacheItem;
        const logMeta = {
          stateSlot: state.slot,
          rootHex,
          epochBoundaryHex,
          persistedKey: persistedKey ? toHexString(persistedKey) : "",
        };

        if (rootHex === epochBoundaryHex) {
          if (persistedKey) {
            // no need to persist
            this.logger.verbose("Pruned checkpoint state from memory but no need to persist", logMeta);
          } else {
            // persist and do not update epochIndex
            this.metrics?.statePersistSecFromSlot.observe(this.clock?.secFromSlot(this.clock?.currentSlot ?? 0) ?? 0);
            const timer = this.metrics?.statePersistDuration.startTimer();
            const cpPersist = {epoch: epoch, root: epochBoundaryRoot};
            persistedKey = await this.datastore.write(cpPersist, state);
            timer?.();
            persistCount++;
            this.logger.verbose("Pruned checkpoint state from memory and persisted to disk", {
              ...logMeta,
              persistedKey: toHexString(persistedKey),
            });
          }
          // overwrite cpKey, this means the state is deleted from memory
          this.cache.set(cpKey, {type: CacheItemType.persisted, value: persistedKey});
        } else {
          if (persistedKey) {
            // persisted file will be eventually deleted by the archive task
            // this also means the state is deleted from memory
            this.cache.set(cpKey, {type: CacheItemType.persisted, value: persistedKey});
            // do not update epochIndex
          } else {
            // delete the state from memory
            this.cache.delete(cpKey);
            this.epochIndex.get(epoch)?.delete(rootHex);
          }
          this.metrics?.statePruneFromMemoryCount.inc();
          this.logger.verbose("Pruned checkpoint state from memory", logMeta);
        }
      }
    }

    return persistCount;
  }

  /**
   * Delete all items of an epoch from disk and memory
   */
  private async deleteAllEpochItems(epoch: Epoch): Promise<void> {
    let persistCount = 0;
    const rootHexes = this.epochIndex.get(epoch) || [];
    for (const rootHex of rootHexes) {
      const key = toCacheKey({rootHex, epoch});
      const cacheItem = this.cache.get(key);

      if (cacheItem) {
        const persistedKey = isPersistedCacheItem(cacheItem) ? cacheItem.value : cacheItem.persistedKey;
        if (persistedKey) {
          await this.datastore.remove(persistedKey);
          persistCount++;
          this.metrics?.persistedStateRemoveCount.inc();
        }
      }
      this.cache.delete(key);
    }
    this.epochIndex.delete(epoch);
    this.logger.verbose("Pruned finalized checkpoints states for epoch", {
      epoch,
      persistCount,
      rootHexes: Array.from(rootHexes).join(","),
    });
  }

  /*
   * It's not sustainable to allocate ~240MB for each state every epoch, so we use buffer pool to reuse the memory.
   * As monitored on holesky as of Jan 2024:
   *   - This does not increase heap allocation while gc time is the same
   *   - It helps stabilize persist time and save ~300ms in average (1.5s vs 1.2s)
   *   - It also helps the state reload to save ~500ms in average (4.3s vs 3.8s)
   *   - Also `serializeState.test.ts` perf test shows a lot of differences allocating ~240MB once vs per state serialization
   */
  private serializeState(state: CachedBeaconStateAllForks): Uint8Array {
    const size = state.type.tree_serializedSize(state.node);
    if (this.bufferPool) {
      const bufferWithKey = this.bufferPool.alloc(size);
      if (bufferWithKey) {
        try {
          const stateBytes = bufferWithKey.buffer;
          const dataView = new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
          state.type.tree_serializeToBytes({uint8Array: stateBytes, dataView}, 0, state.node);
          return stateBytes;
        } finally {
          this.bufferPool.free(bufferWithKey.key);
        }
      }
    }

    this.metrics?.persistedStateAllocCount.inc();
    return state.serialize();
  }

  /**
   * Serialize validators to bytes leveraging the buffer pool to save memory allocation.
   *   - As monitored on holesky as of Jan 2024, it helps save ~500ms state reload time (4.3s vs 3.8s)
   *   - Also `serializeState.test.ts` perf test shows a lot of differences allocating validators bytes once vs every time,
   * This is 2x - 3x faster than allocating memory every time.
   * TODO: consider serializing validators manually like in `serializeState.test.ts` perf test, this could be 3x faster than this
   */
  private serializeStateValidators(state: CachedBeaconStateAllForks): Uint8Array {
    const type = state.type.fields.validators;
    const size = type.tree_serializedSize(state.validators.node);
    if (this.bufferPool) {
      const bufferWithKey = this.bufferPool.alloc(size);
      if (bufferWithKey) {
        try {
          const validatorsBytes = bufferWithKey.buffer;
          const dataView = new DataView(validatorsBytes.buffer, validatorsBytes.byteOffset, validatorsBytes.byteLength);
          type.tree_serializeToBytes({uint8Array: validatorsBytes, dataView}, 0, state.validators.node);
          return validatorsBytes;
        } finally {
          this.bufferPool.free(bufferWithKey.key);
        }
      }
    }

    this.metrics?.stateReloadValidatorsSszAllocCount.inc();
    return state.validators.serialize();
  }
}

export function toCheckpointHex(checkpoint: phase0.Checkpoint): CheckpointHex {
  return {
    epoch: checkpoint.epoch,
    rootHex: toHexString(checkpoint.root),
  };
}

function toCacheKey(cp: CheckpointHex | phase0.Checkpoint): CacheKey {
  if (isCheckpointHex(cp)) {
    return `${cp.rootHex}_${cp.epoch}`;
  }
  return `${toHexString(cp.root)}_${cp.epoch}`;
}

function fromCacheKey(key: CacheKey): CheckpointHex {
  const [rootHex, epoch] = key.split("_");
  return {
    rootHex,
    epoch: Number(epoch),
  };
}

function isCachedBeaconState(
  stateOrBytes: CachedBeaconStateAllForks | LoadedStateBytesData
): stateOrBytes is CachedBeaconStateAllForks {
  return (stateOrBytes as CachedBeaconStateAllForks).slot !== undefined;
}

function isInMemoryCacheItem(cacheItem: CacheItem): cacheItem is InMemoryCacheItem {
  return cacheItem.type === CacheItemType.inMemory;
}

function isPersistedCacheItem(cacheItem: CacheItem): cacheItem is PersistedCacheItem {
  return cacheItem.type === CacheItemType.persisted;
}

function isCheckpointHex(cp: CheckpointHex | phase0.Checkpoint): cp is CheckpointHex {
  return (cp as CheckpointHex).rootHex !== undefined;
}
