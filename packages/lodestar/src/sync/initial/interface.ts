import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Checkpoint, Epoch} from "@chainsafe/lodestar-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IService} from "../../node";
import {ISyncModule} from "../interface";
import {ISyncStats} from "../stats";
import {IBeaconDb} from "../../db";

export interface IInitialSyncModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  network: INetwork;
  logger: ILogger;
  db: IBeaconDb;
  stats?: ISyncStats;
}

export interface IInitialSyncEvents {
  "sync:checkpoint": (epoch: Epoch) => void;
  "sync:completed": (target: Checkpoint) => void;
}
export type InitialSyncEventEmitter = StrictEventEmitter<EventEmitter, IInitialSyncEvents>;

export type InitialSync = IService & InitialSyncEventEmitter & ISyncModule;
