import {BeaconApi, ValidatorApi} from "../../rpc/api";
import {Epoch, Slot} from "../../types";

export interface RpcClient {

  beacon: BeaconApi;

  validator: ValidatorApi;

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
  onNewSlot(cb: (slot: Slot) => void);


  /**
   * Invokes callback on new head block.
   * Depending on implementation it will poll for new head block or getting notified(Websockets)
   * @param cb
   */
  onEpoch(cb: (epoch: Epoch) => void);

}
