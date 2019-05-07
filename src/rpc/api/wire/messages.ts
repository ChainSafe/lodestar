import {Slot} from "../../types/primitive";
import {BlockRootSlot, HashTreeRoot} from "./types";

type RPCMethod = Hello | Goodbye | GetStatus;

export interface Request {
  id: number;
  method_id: number;
  body: string;
}

export interface Response {
  id: number;
  response_code: number;
  result: Buffer;
}

// Method ID: 0

export interface Hello {
  network_id: number;
  chain_id: number;
  latest_finalized_root: Buffer;
  latest_finalized_epoch: number;
  best_root: Buffer;
  best_slot: Slot;
}

// Method ID: 1

export interface Goodbye {
  reason: number;
}

// Method ID: 2

export interface GetStatus {
  sha: Buffer;
  user_agent: Buffer;
  timestamp: number;
} 

// Method ID: 10

export interface BeaconBlockRootsRequest {
  start_slot: Slot;
  count: number;
}

export interface BeaconBlockRootsResponse {
  block_root: Buffer;
  slot: Slot;
  // Doesn't currently exist as a standalone type
  roots: []BlockRootSlot;
}

// Method ID: 11
export interface BeaconBlockHeadersRequest {
  // Doesn't currently exist as a standalone type	
  start_root: HashTreeRoot; 
  start_slot: Slot;
  max_headers: number;
  skip_slots: number;
}

export interface BeaconBlockHeadersResponse {
  // Doesn't currently exist as a standalone type
  headers: []BeaconBlockHeader
}

// Method ID: 12
export interface BeaconBlockBodiesRequest {
  block_roots: []HashTreeRoot;
}

export interface BeaconBlockBodiesResponse {
  block_bodies: []BeaconBlockBody;
}

// Method ID: 13
export interface BeaconChainStateRequest {
  hashes: []HashTreeRoot;
}

// Method ID: 14
// Not yet defined in the ETH2.0 Wire spec.
export interface BeaconChainStateResponse {

}
