import {Logger} from "@lodestar/utils";
import {RootHex, Slot, phase0} from "@lodestar/types";
import {BeaconConfig} from "@lodestar/config";
import {routes} from "@lodestar/api";
import {BlockInput} from "../chain/blocks/types.js";
import {INetwork} from "../network/index.js";
import {IBeaconChain} from "../chain/index.js";
import {Metrics} from "../metrics/index.js";
import {IBeaconDb} from "../db/index.js";
import {SyncChainDebugState} from "./range/chain.js";
export {SyncChainDebugState};

export type SyncingStatus = routes.node.SyncingStatus;

export interface IBeaconSync {
  state: SyncState;
  close(): void;
  getSyncStatus(): SyncingStatus;
  isSynced(): boolean;
  isSyncing(): boolean;
  getSyncChainsDebugState(): SyncChainDebugState[];
}

export enum SyncState {
  /** No useful peers are connected */
  Stalled = "Stalled",
  /** The node is performing a long-range sync over a finalized chain */
  SyncingFinalized = "SyncingFinalized",
  /** The node is performing a long-range sync over head chains */
  SyncingHead = "SyncingHead",
  /** The node is up to date with all known peers */
  Synced = "Synced",
}

/** Map a SyncState to an integer for rendering in Grafana */
export const syncStateMetric: {[K in SyncState]: number} = {
  [SyncState.Stalled]: 0,
  [SyncState.SyncingFinalized]: 1,
  [SyncState.SyncingHead]: 2,
  [SyncState.Synced]: 3,
};

export type SlotRange = {
  start: Slot;
  end: Slot;
};

export interface SyncModules {
  config: BeaconConfig;
  network: INetwork;
  db: IBeaconDb;
  metrics: Metrics | null;
  logger: Logger;
  chain: IBeaconChain;
  wsCheckpoint?: phase0.Checkpoint;
}

export type PendingBlock = {
  blockRootHex: RootHex;
  parentBlockRootHex: RootHex;
  blockInput: BlockInput;
  peerIdStrs: Set<string>;
  status: PendingBlockStatus;
  downloadAttempts: number;
};
export enum PendingBlockStatus {
  pending = "pending",
  fetching = "fetching",
  processing = "processing",
}
