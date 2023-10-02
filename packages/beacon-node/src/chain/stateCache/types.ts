import fs from "node:fs";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0} from "@lodestar/types";
import {Logger, removeFile, writeIfNotExist, ensureDir} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {ShufflingCache} from "../shufflingCache.js";

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
  pruneFromMemory(): number;
  clear(): void;
  dumpSummary(): routes.lodestar.StateCacheItem[];
}

// Make this generic to support testing
export type PersistentApis = {
  writeIfNotExist: (filepath: string, bytes: Uint8Array) => Promise<boolean>;
  removeFile: (path: string) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array>;
  ensureDir: (path: string) => Promise<void>;
};

// Default persistent api for a regular node, use other persistent apis for testing
export const FILE_APIS: PersistentApis = {
  writeIfNotExist,
  removeFile,
  readFile: fs.promises.readFile,
  ensureDir,
};

export const CHECKPOINT_STATES_FOLDER = "./unfinalized_checkpoint_states";

export type StateFile = string;

export enum CacheType {
  state = "state",
  file = "file",
}

// Reason to remove a state file from disk
export enum RemoveFileReason {
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
  getHeadState?: GetHeadStateFn;
  persistentApis?: PersistentApis;
};
