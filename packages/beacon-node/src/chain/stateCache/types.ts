import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {ShufflingCache} from "../shufflingCache.js";
import {CPStatePersistentApis} from "./persistent/types.js";

export type CheckpointHex = {epoch: Epoch; rootHex: RootHex};

export interface CheckpointStateCache {
  getOrReload(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | null>;
  getStateOrBytes(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | Uint8Array | null>;
  get(cpOrKey: CheckpointHex | string): CachedBeaconStateAllForks | null;
  add(cp: phase0.Checkpoint, state: CachedBeaconStateAllForks): void;
  getLatest(rootHex: RootHex, maxEpoch: Epoch): CachedBeaconStateAllForks | null;
  getOrReloadLatest(rootHex: RootHex, maxEpoch: Epoch): Promise<CachedBeaconStateAllForks | null>;
  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null;
  pruneFinalized(finalizedEpoch: Epoch): void;
  delete(cp: phase0.Checkpoint): void;
  pruneFromMemory(): Promise<number>;
  clear(): void;
  dumpSummary(): routes.lodestar.StateCacheItem[];
}

export const CHECKPOINT_STATES_FOLDER = "./unfinalized_checkpoint_states";

export type CheckpointKey = string;

export enum CacheType {
  state = "state",
  persistence = "persistence",
}

// Reason to remove a checkpoint state from file/db
export enum RemovePersistedStateReason {
  pruneFinalized = "prune_finalized",
  reload = "reload",
  stateUpdate = "state_update",
}

export type GetHeadStateFn = () => CachedBeaconStateAllForks;

export type PersistentCheckpointStateCacheOpts = {
  // Keep max n states in memory, persist the rest to disk
  maxEpochsInMemory: number;
};

export type PersistentCheckpointStateCacheModules = {
  metrics?: Metrics | null;
  logger: Logger;
  clock?: IClock | null;
  shufflingCache: ShufflingCache;
  persistentApis: CPStatePersistentApis;
  getHeadState?: GetHeadStateFn;
};
