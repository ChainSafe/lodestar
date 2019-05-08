import {Slot, bytes32, bytes, unint8, uint16, uint64} from "../../types/primitive";
import {BlockRootSlot, HashTreeRoot} from "./types";

interface RequestBody {

}

export interface Request {
  id: uint64;
  methodId: uint16;
  body: RequestBody;
}

export interface Response {
  id: uint64;
  responseCode: uint16;
  result: Buffer;
}

// Method ID: 0

export interface Hello extends RequestBody {
  networkId: uint64;
  chainId: uint16;
  latestFinalizedRoot: bytes32;
  latestFinalizedEpoch: uint64;
  bestRoot: bytes32;
  bestSlot: Slot;
}

// Method ID: 1

export interface Goodbye extends RequestBody {
  reason: uint64;
}

// Method ID: 2

export interface GetStatus extends RequestBody {
  sha: bytes32;
  userAgent: bytes;
  timestamp: uint64;
}

// Method ID: 10

export interface BeaconBlockRootsRequest extends RequestBody {
  startSlot: Slot;
  count: uint64;
}

export interface BeaconBlockRootsResponse {
  blockRoot: bytes32;
  slot: Slot;
  // Doesn't currently exist as a standalone type
  roots: []BlockRootSlot;
}

// Method ID: 11
export interface BeaconBlockHeadersRequest extends RequestBody {
  // Doesn't currently exist as a standalone type	
  startRoot: HashTreeRoot; 
  startSlot: Slot;
  maxHeaders: uint64;
  skipSlots: uint64;
}

export interface BeaconBlockHeadersResponse {
  // Doesn't currently exist as a standalone type
  headers: []BeaconBlockHeader;
}

// Method ID: 12
export interface BeaconBlockBodiesRequest extends RequestBody {
  blockRoots: []HashTreeRoot;
} 

export interface BeaconBlockBodiesResponse {
  blockBodies: []BeaconBlockBody;
}

// Method ID: 13
export interface BeaconChainStateRequest extends RequestBody {
  hashes: []HashTreeRoot;
}

// Method ID: 14
// Not yet defined in the ETH2.0 Wire spec.
export interface BeaconChainStateResponse {

}
