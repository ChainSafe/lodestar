import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {IReputationStore} from "../IReputation";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Checkpoint, Epoch} from "@chainsafe/lodestar-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IService} from "../../node";

export interface IInitialSyncModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  network: INetwork;
  reputationStore: IReputationStore;
  logger: ILogger;
}

export interface IInitialSyncEvents {
  "sync:checkpoint": (epoch: Epoch) => void;
  "sync:completed": (target: Checkpoint) => void;
}
export type InitialSyncEventEmitter = StrictEventEmitter<EventEmitter, IInitialSyncEvents>;

export type InitialSync = IService & InitialSyncEventEmitter;