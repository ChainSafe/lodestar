import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {IReputationStore} from "../reputation";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Checkpoint, Epoch} from "@chainsafe/lodestar-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IService} from "../../node";
import {ISyncModule} from "../interface";
import {ISyncStats} from "../stats";

export interface IInitialSyncModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  network: INetwork;
  reputationStore: IReputationStore;
  logger: ILogger;
  stats?: ISyncStats;
}

export interface IInitialSyncEvents {
  "sync:checkpoint": (epoch: Epoch) => void;
  "sync:completed": (target: Checkpoint) => void;
}
export type InitialSyncEventEmitter = StrictEventEmitter<EventEmitter, IInitialSyncEvents>;

export type InitialSync = IService & InitialSyncEventEmitter & ISyncModule;
