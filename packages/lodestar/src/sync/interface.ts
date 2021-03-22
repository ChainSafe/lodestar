import {INetwork} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {CommitteeIndex, Slot, phase0} from "@chainsafe/lodestar-types";
import {IRegularSync} from "./regular";
import {IBeaconChain} from "../chain";
import {IBeaconMetrics} from "../metrics";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db/api";
import {AttestationCollector} from "./utils";
import {BeaconGossipHandler} from "./gossip";

export enum SyncMode {
  WAITING_PEERS,
  INITIAL_SYNCING,
  REGULAR_SYNCING,
  SYNCED,
  STOPPED,
}

export interface IBeaconSync {
  state: SyncMode;
  start(): Promise<void>;
  stop(): Promise<void>;
  getSyncStatus(): phase0.SyncingStatus;
  isSynced(): boolean;
  collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): void;
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
  logger: ILogger;
  chain: IBeaconChain;
  metrics?: IBeaconMetrics;
  regularSync?: IRegularSync;
  gossipHandler?: BeaconGossipHandler;
  attestationCollector?: AttestationCollector;
}
