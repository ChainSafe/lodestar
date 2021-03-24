import {ILogger} from "@chainsafe/lodestar-utils";
import {CommitteeIndex, Slot, phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {INetwork} from "../network";
import {BeaconGossipHandler} from "./gossip";
import {IBeaconChain} from "../chain";
import {IBeaconMetrics} from "../metrics";
import {IBeaconDb} from "../db/api";
import {AttestationCollector} from "./utils";
import {SyncChainDebugState} from "./range/chain";
export {SyncChainDebugState};

export interface IBeaconSync {
  state: SyncState;
  close(): void;
  getSyncStatus(): phase0.SyncingStatus;
  isSynced(): boolean;
  isSyncing(): boolean;
  collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): void;
  getSyncChainsDebugState(): SyncChainDebugState[];
}

export enum SyncState {
  /** The node is performing a long-range sync over a finalized chain */
  SyncingFinalized = "SyncingFinalized",
  /** The node is performing a long-range sync over head chains */
  SyncingHead = "SyncingHead",
  /** The node is up to date with all known peers */
  Synced = "Synced",
  /** No useful peers are connected */
  Stalled = "Stalled",
}

export interface ISyncModule {
  getHighestBlock(): Slot;
}

export interface ISlotRange {
  start: Slot;
  end: Slot;
}

export interface ISyncModules {
  config: IBeaconConfig;
  network: INetwork;
  db: IBeaconDb;
  metrics?: IBeaconMetrics;
  logger: ILogger;
  chain: IBeaconChain;
  gossipHandler?: BeaconGossipHandler;
  attestationCollector?: AttestationCollector;
}
