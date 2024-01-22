import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0} from "@lodestar/types";
import {routes} from "@lodestar/api";

export type CheckpointHex = {epoch: Epoch; rootHex: RootHex};

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
  clear(): void;
  size: number;
  prune(headStateRootHex: RootHex): void;
  deleteAllBeforeEpoch(finalizedEpoch: Epoch): void;
  dumpSummary(): routes.lodestar.StateCacheItem[];
  getStates(): IterableIterator<CachedBeaconStateAllForks>; // Expose beacon states stored in cache. Use with caution
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
  getOrReload(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | null>;
  getStateOrBytes(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | Uint8Array | null>;
  get(cpOrKey: CheckpointHex | string): CachedBeaconStateAllForks | null;
  add(cp: phase0.Checkpoint, state: CachedBeaconStateAllForks): void;
  getLatest(rootHex: RootHex, maxEpoch: Epoch): CachedBeaconStateAllForks | null;
  getOrReloadLatest(rootHex: RootHex, maxEpoch: Epoch): Promise<CachedBeaconStateAllForks | null>;
  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null;
  prune(finalizedEpoch: Epoch, justifiedEpoch: Epoch): void;
  pruneFinalized(finalizedEpoch: Epoch): void;
  processState(blockRootHex: RootHex, state: CachedBeaconStateAllForks): Promise<number>;
  clear(): void;
  dumpSummary(): routes.lodestar.StateCacheItem[];
  getStates(): IterableIterator<CachedBeaconStateAllForks>; // Expose beacon states stored in cache. Use with caution
}

export enum CacheItemType {
  persisted = "persisted",
  inMemory = "in-memory",
}
