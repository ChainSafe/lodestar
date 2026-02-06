import {routes} from "@lodestar/api";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0} from "@lodestar/types";

/**
 * Checkpoint hex representation for state cache keys.
 * Extends CheckpointWithHex (from fork-choice) with payloadPresent.
 * For Gloas (ePBS), payloadPresent distinguishes between block state and payload state.
 * - payloadPresent = true: payload state (after processing execution payload) - always true for pre-Gloas
 * - payloadPresent = false: block state (after processing beacon block, before payload)
 */
export type CheckpointHexPayload = {epoch: Epoch; rootHex: RootHex; payloadPresent: boolean};

/**
 * Lodestar currently keeps two state caches around.
 *
 * 1. BlockStateCache is keyed by state root, and intended to keep extremely recent states around (eg: post states from the latest blocks)
 *    These states are most likely to be useful for state transition of new blocks.
 *
 * 2. CheckpointStateCache is keyed by checkpoint, and intended to keep states which have just undergone an epoch transition.
 *    These states are useful for gossip verification and for avoiding an epoch transition during state transition of first-in-epoch blocks
 */

/**
 * Store up to n recent block states.
 *
 * The cache key is state root
 */
export interface BlockStateCache {
  get(rootHex: RootHex): CachedBeaconStateAllForks | null;
  add(item: CachedBeaconStateAllForks): void;
  setHeadState(item: CachedBeaconStateAllForks | null): void;
  /**
   * Get a seed state for state reload.
   */
  getSeedState(): CachedBeaconStateAllForks;
  clear(): void;
  size: number;
  prune(headStateRootHex: RootHex): void;
  deleteAllBeforeEpoch(finalizedEpoch: Epoch): void;
  dumpSummary(): routes.lodestar.StateCacheItem[];
  /** Expose beacon states stored in cache. Use with caution */
  getStates(): IterableIterator<CachedBeaconStateAllForks>;
}

/**
 * Store checkpoint states to preserve epoch transition, this helps lodestar run exactly 1 epoch transition per epoch in normal network conditions.
 *
 * There are 2 types of checkpoint states:
 *
 * - Previous Root Checkpoint State: where root is from previous epoch, this is added when we prepare for next slot,
 * or to validate gossip block
 * ```
 *        epoch:       (n-2)   (n-1)     n     (n+1)
 *               |-------|-------|-------|-------|
 *        root     ---------------------^
 * ```
 *
 * - Current Root Checkpoint State: this is added when we process block slot 0 of epoch n, note that this block could
 * be skipped so we don't always have this checkpoint state
 * ```
 *        epoch:       (n-2)   (n-1)     n     (n+1)
 *               |-------|-------|-------|-------|
 *        root      ---------------------^
 * ```
 */
export interface CheckpointStateCache {
  init?: () => Promise<void>;
  getOrReload(cp: CheckpointHexPayload): Promise<CachedBeaconStateAllForks | null>;
  getStateOrBytes(cp: CheckpointHexPayload): Promise<CachedBeaconStateAllForks | Uint8Array | null>;
  get(cpOrKey: CheckpointHexPayload | string): CachedBeaconStateAllForks | null;
  /**
   * Add checkpoint state to cache.
   * @param cp - Checkpoint (epoch + root)
   * @param state - Cached beacon state
   * @param payloadPresent - For Gloas: true if this is payload state, false if block state.
   *                         Always true for pre-Gloas.
   */
  add(cp: phase0.Checkpoint, state: CachedBeaconStateAllForks, payloadPresent: boolean): void;
  getLatest(rootHex: RootHex, maxEpoch: Epoch, payloadPresent: boolean): CachedBeaconStateAllForks | null;
  getOrReloadLatest(
    rootHex: RootHex,
    maxEpoch: Epoch,
    payloadPresent: boolean
  ): Promise<CachedBeaconStateAllForks | null>;
  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch, payloadPresent: boolean): number | null;
  prune(finalizedEpoch: Epoch, justifiedEpoch: Epoch): void;
  pruneFinalized(finalizedEpoch: Epoch): void;
  /**
   * Process state for checkpoint caching and memory management.
   * Manages both block state and payload state variants together based on root canonicality.
   * @param blockRootHex - Block root hex
   * @param state - Cached beacon state
   */
  processState(blockRootHex: RootHex, state: CachedBeaconStateAllForks): Promise<number>;
  clear(): void;
  dumpSummary(): routes.lodestar.StateCacheItem[];
  /** Expose beacon states stored in cache. Use with caution */
  getStates(): IterableIterator<CachedBeaconStateAllForks>;
}

export enum CacheItemType {
  persisted = "persisted",
  inMemory = "in-memory",
}
