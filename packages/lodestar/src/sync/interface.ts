import {IService} from "../node";
import {INetwork} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {CommitteeIndex, Slot, SyncingStatus} from "@chainsafe/lodestar-types";
import {IRegularSync} from "./regular";
import {IGossipHandler} from "./gossip";
import {IReqRespHandler} from "./reqResp";
import {IBeaconChain} from "../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db/api";
import {AttestationCollector} from "./utils";

export enum SyncMode {
  WAITING_PEERS,
  INITIAL_SYNCING,
  REGULAR_SYNCING,
  SYNCED,
  STOPPED,
}

export interface IBeaconSync extends IService {
  state: SyncMode;
  getSyncStatus(): Promise<SyncingStatus>;
  isSynced(): boolean;
  collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): Promise<void>;
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
  regularSync?: IRegularSync;
  reqRespHandler?: IReqRespHandler;
  gossipHandler?: IGossipHandler;
  attestationCollector?: AttestationCollector;
}
