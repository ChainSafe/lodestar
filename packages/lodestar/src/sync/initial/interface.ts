import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import PeerInfo from "peer-info";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {ReputationStore} from "../IReputation";
import {ILogger} from "../../logger";
import {Checkpoint, Epoch} from "@chainsafe/eth2.0-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IService} from "../../node";

export interface IInitialSyncModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  network: INetwork;
  reps: ReputationStore;
  logger: ILogger;
  peers: PeerInfo[];
}

export interface IInitialSyncEvents {
  "sync:checkpoint": (epoch: Epoch) => void;
  "sync:completed": (target: Checkpoint) => void;
}
export type InitialSyncEventEmitter = StrictEventEmitter<EventEmitter, IInitialSyncEvents>;

export type InitialSync = IService & InitialSyncEventEmitter;