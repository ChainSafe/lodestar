import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "./interface/beacon";
import {IValidatorApi} from "./interface/validators";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {INodeApi} from "./interface/node";
import {BeaconEventEmitter, IEventsApi} from "./interface/events";

export interface IApiClientEvents {
  beaconChainStarted: () => void;
}

export type ApiClientEventEmitter = StrictEventEmitter<EventEmitter, IApiClientEvents>;

export interface IBeaconClock {
  currentSlot: Slot;
  currentEpoch: Epoch;
}

export interface IApiClient extends ApiClientEventEmitter {
  beacon: IBeaconApi;
  node: INodeApi;
  events: IEventsApi;
  validator: IValidatorApi;
  emitter: BeaconEventEmitter;
  clock: IBeaconClock;

  url: string;

  /**
   * Initiates connection to rpc server.
   */
  connect(): Promise<void>;

  /**
   * Destroys connection to rpc server.
   */
  disconnect(): Promise<void>;
}
