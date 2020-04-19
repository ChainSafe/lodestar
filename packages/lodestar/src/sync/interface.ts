import {IService} from "../node";
import {INetwork} from "../network";
import {IReputationStore} from "./IReputation";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Slot, SyncingStatus} from "@chainsafe/lodestar-types";
import {InitialSync} from "./initial";
import {IRegularSync} from "./regular";
import {IGossipHandler} from "./gossip";
import {IReqRespHandler} from "./reqResp";
import {IBeaconChain} from "../chain";
import {OpPool} from "../opPool";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db/api";

export interface IBeaconSync extends IService {
  getSyncStatus(): SyncingStatus|null;
  isSynced(): boolean;
}

export interface ISlotRange {
  start: Slot;
  end: Slot;
}

export interface ISyncModules {
  config: IBeaconConfig;
  network: INetwork;
  db: IBeaconDb;
  reputationStore: IReputationStore;
  logger: ILogger;
  chain: IBeaconChain;
  opPool: OpPool;
  initialSync?: InitialSync;
  regularSync?: IRegularSync;
  reqRespHandler?: IReqRespHandler;
  gossipHandler?: IGossipHandler;
}