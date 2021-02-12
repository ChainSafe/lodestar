import {Epoch, Slot, Root} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "./interface/beacon";
import {IValidatorApi} from "./interface/validators";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {INodeApi} from "./interface/node";
import {BeaconBlockEvent, BeaconChainReorgEvent, BeaconEventType, HeadEvent, IEventsApi} from "./interface/events";
import {ClockEpochEvent, ClockEventType, ClockSlotEvent} from "./interface/clock";
import {IConfigApi} from "./interface/config";

export interface IApiClientEvents {
  beaconChainStarted: () => void;
  [BeaconEventType.BLOCK]: (evt: BeaconBlockEvent["message"]) => void;
  [BeaconEventType.CHAIN_REORG]: (evt: BeaconChainReorgEvent["message"]) => void;
  [BeaconEventType.HEAD]: (evt: HeadEvent["message"]) => void;
  [ClockEventType.CLOCK_SLOT]: (evt: ClockSlotEvent["message"]) => void;
  [ClockEventType.CLOCK_EPOCH]: (evt: ClockEpochEvent["message"]) => void;
}

export type ApiClientEventEmitter = StrictEventEmitter<EventEmitter, IApiClientEvents>;

export interface IBeaconClock {
  currentSlot: Slot;
  currentEpoch: Epoch;
}

export interface IApiClient extends ApiClientEventEmitter {
  beacon: IBeaconApi;
  configApi: IConfigApi;
  node: INodeApi;
  events: IEventsApi;
  validator: IValidatorApi;
  clock: IBeaconClock;
  genesisValidatorsRoot: Root;
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
