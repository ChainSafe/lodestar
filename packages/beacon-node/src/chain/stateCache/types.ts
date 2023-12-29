import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0} from "@lodestar/types";
import {routes} from "@lodestar/api";

export type CheckpointHex = {epoch: Epoch; rootHex: RootHex};

/**
 * Store up to n recent block states.
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
}

/**
 * Store checkpoint states to preserve epoch transition, this helps lodestar run exactly 1 epoch transition per epoch
 * There are 2 types of checkpoint states:
 *
 * - Previous Root Checkpoint State where root is from previous epoch, this is added when we prepare for next slot,
 * or to validate gossip block
 *        epoch:       (n-2)   (n-1)     n     (n+1)
 *               |-------|-------|-------|-------|
 *        root     ---------------------^
 *
 * - Current Root Checkpoint State: this is added when we process block slot 0 of epoch n, note that this block could
 * be skipped so we don't always have this checkpoint state
 *        epoch:       (n-2)   (n-1)     n     (n+1)
 *               |-------|-------|-------|-------|
 *        root      ---------------------^
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
}

export const CHECKPOINT_STATES_FOLDER = "./unfinalized_checkpoint_states";

export type CheckpointKey = string;

export enum CacheType {
  persisted = "persisted",
  inMemory = "in-memory",
}

export type GetHeadStateFn = () => CachedBeaconStateAllForks;

export type PersistentCheckpointStateCacheOpts = {
  // Keep max n states in memory, persist the rest to disk
  maxCPStateEpochsInMemory?: number;
};
