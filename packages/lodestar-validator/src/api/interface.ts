import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "./interface/beacon";
import {IValidatorApi} from "./interface/validators";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";

export interface INewSlotCallback {
  (slot: Slot): void;
}

export interface INewEpochCallback {
  (slot: Epoch): void;
}

export interface IApiClientEvents {
  beaconChainStarted: () => void;
}

export type ApiClientEventEmitter = StrictEventEmitter<EventEmitter, IApiClientEvents>;

export interface IApiClient extends ApiClientEventEmitter {

  beacon: IBeaconApi;

  validator: IValidatorApi;

  url: string;

  /**
   * Initiates connection to rpc server.
   */
  connect(): Promise<void>;

  /**
   * Destroys connection to rpc server.
   */
  disconnect(): Promise<void>;

  getCurrentSlot(): Slot;

  /**
   * Invokes callback on new slot.
   * Depending on implementation it will poll for new slot or getting notified(Websockets)
   * @param cb
   */
  onNewSlot(cb: INewSlotCallback): void;


  /**
   * Invokes callback on new epoch.
   * Depending on implementation it will poll for new epoch or getting notified(Websockets)
   * @param cb
   */
  onNewEpoch(cb: INewEpochCallback): void;

}
