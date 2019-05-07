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
  GetStatus,
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
  GetStatus(): Promise<GetStatus>;

  /**
   * Returns list of block roots and slots from the peer
   */
  RequestBeaconBlockRoots(request: BeaconBlockRootsRequest): Promise<BeaconBlockRootsResponse>;

  /**
   * Returns beacon block headers from peer
   */
  RequestBeaconBlockHeaders(request: BeaconBlockHeadersRequest): Promise<BeaconBlockHeaderResponse>;

  /**
   * Returns block bodies associated with block roots from a peer
   */
  RequestBeaconBlockBodies(request: BeaconBlockBodiesRequest): Promise<BeaconBlockBodiesResponse>;

  /**
   * Returns the hashes of merkle tree nodes from merkelizing the block's state root.
   */
  RequestBeaconChainStateRequest(request: BeaconChainStateRequest): Promise<BeaconChainStateResponse>;
  
}
