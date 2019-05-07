import {IApi} from "../interface";
import {
  BeaconBlock,
  BeaconState,
  bytes32,
  Fork,
  number64,
  SyncingStatus
}  from "../../../types";

import {
  Request,
  Response,
  Hello,
  Goodbye,
  GetStatusRequest,
  GetStatusResponse,
  BeaconBlockRootsRequest,
  BeaconBlockRootsResponse,
  BeaconBlockHeaderRequest,
  BeaconBlockHeaderResponse,
  BeaconBlockBodiesRequest,
  BeaconBlockBodiesResponse,
  BeaconChainStateRequest,
  BeaconChainStateResponse
} from "./messages";

import {
  BlockRootSlot,
  HashTreeRoot
} from "./types";

export interface IWireProtocolApi extends IApi {

  /**
   * Returns metadata about the remote node.
   */
  GetStatus(): Promise<>
}
