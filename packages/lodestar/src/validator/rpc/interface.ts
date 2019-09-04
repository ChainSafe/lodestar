import {IBeaconApi, IValidatorApi} from "../../api/rpc/api";
import {Epoch, Slot} from "@chainsafe/eth2.0-types";

export interface NewSlotCallback {
  (slot: Slot): void;
}

export interface NewEpochCallback {
  (slot: Epoch): void;
}

export interface RpcClient {

  beacon: IBeaconApi;

  validator: IValidatorApi;

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
  onNewSlot(cb: NewSlotCallback): void;


  /**
   * Invokes callback on new epoch.
   * Depending on implementation it will poll for new epoch or getting notified(Websockets)
   * @param cb
   */
  onNewEpoch(cb: NewEpochCallback): void;

}
