import {INetwork} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Slot, phase0} from "@chainsafe/lodestar-types";
import {IRegularSync} from "./regular";
import {IBeaconChain} from "../chain";
import {IMetrics} from "../metrics";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
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
  metrics: IMetrics | null;
  regularSync?: IRegularSync;
  gossipHandler?: BeaconGossipHandler;
  attestationCollector?: AttestationCollector;
}
