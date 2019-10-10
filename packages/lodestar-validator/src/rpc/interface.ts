import {Epoch, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconApi} from "./api/beacon";
import {IValidatorApi} from "./api/validators";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";

export interface INewSlotCallback {
  (slot: Slot): void;
}

export interface INewEpochCallback {
  (slot: Epoch): void;
}

export interface IRpcClientEvents {
  beaconChainStarted: () => void;
}

export type RpcClientEventEmitter = StrictEventEmitter<EventEmitter, IRpcClientEvents>;

export interface IRpcClient extends RpcClientEventEmitter {

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
