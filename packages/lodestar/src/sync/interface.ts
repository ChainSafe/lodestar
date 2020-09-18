import {IService} from "../node";
import {INetwork} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {CommitteeIndex, Slot, SyncingStatus, Root} from "@chainsafe/lodestar-types";
import {InitialSync} from "./initial";
import {IRegularSync} from "./regular";
import {IGossipHandler} from "./gossip";
import {IReqRespHandler} from "./reqResp";
import {IBeaconChain} from "../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db/api";
import {AttestationCollector} from "./utils";

export interface IBeaconSync extends IService {
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

export interface ISyncCheckpoint {
  slot: Slot;
  blockRoot: Root;
}

export interface ISyncModules {
  config: IBeaconConfig;
  network: INetwork;
  db: IBeaconDb;
  logger: ILogger;
  chain: IBeaconChain;
  initialSync?: InitialSync;
  regularSync?: IRegularSync;
  reqRespHandler?: IReqRespHandler;
  gossipHandler?: IGossipHandler;
  attestationCollector?: AttestationCollector;
}
