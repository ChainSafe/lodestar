import {BeaconAPI} from "../../rpc/api";
import {AttestationData, BeaconState, Slot} from "../../types";

export interface RpcClient {

  beacon: BeaconAPI;

  //validator: ValidatorAPI

  /**
   * Initiates connection to rpc server.
   */
  connect(): Promise<void>;

  /**
   * Initiates connection to rpc server.
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
  onNewBeaconState(cb: (state: BeaconState) => void);

  /**
   * Invokes callback on new attestation data.
   * Depending on implementation it will poll for attestation data or getting notified(Websockets)
   * @param cb
   */
  onNewAttestation(cb: (attestation: AttestationData) => void);



}
