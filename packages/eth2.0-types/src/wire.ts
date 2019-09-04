import {Slot, Hash, bytes, uint16, uint64, bytes8, Epoch, number64} from "./primitive";
import {BeaconBlockBody} from "./block";
import {BeaconBlockHeader} from "./misc";
import {BeaconState} from "./state";

export type RequestId = string;
export type Method = number;

export interface BlockRootSlot {
  blockRoot: Hash;
  slot: Slot;
}

export interface WireRequest {
  id: bytes8;
  method: uint16;
  body: bytes;
}

export interface WireResponse {
  id: bytes8;
  responseCode: uint16;
  result: bytes;
}

export interface RpcRequest {
  id: uint64;
  method: uint16;
  body: RequestBody;
}

export interface RpcResponse {
  id: uint64;
  responseCode: uint16;
  result?: ResponseBody;
}

export type RequestBody =
  Hello | Goodbye | Status |
  BeaconBlockRootsRequest | BeaconBlockHeadersRequest | BeaconBlockBodiesRequest |
  BeaconStatesRequest;

export type ResponseBody =
  Hello | Goodbye | Status |
  BeaconBlockRootsResponse | BeaconBlockHeadersResponse | BeaconBlockBodiesResponse |
  BeaconStatesResponse;

// Method ID: 0

export interface Hello {
  networkId: uint64;
  chainId: uint16;
  latestFinalizedRoot: Hash;
  latestFinalizedEpoch: Epoch;
  bestRoot: Hash;
  bestSlot: Slot;
}

// Method ID: 1

export interface Goodbye {
  reason: uint64;
}

// Method ID: 2

export interface Status {
  sha: Hash;
  userAgent: bytes;
  timestamp: number64;
}

// Method ID: 10

export interface BeaconBlockRootsRequest {
  startSlot: Slot;
  count: number64;
}

export interface BeaconBlockRootsResponse {
  roots: BlockRootSlot[];
}

// Method ID: 11

export interface BeaconBlockHeadersRequest {
  startRoot: Hash; 
  startSlot: Slot;
  maxHeaders: number64;
  skipSlots: number64;
}

export interface BeaconBlockHeadersResponse {
  headers: BeaconBlockHeader[];
}

// Method ID: 12

export interface BeaconBlockBodiesRequest {
  blockRoots: Hash[];
} 

export interface BeaconBlockBodiesResponse {
  blockBodies: BeaconBlockBody[];
}

// Method ID: 13

export interface BeaconStatesRequest {
  hashes: Hash[];
}

export interface BeaconStatesResponse {
  states: BeaconState[];
}
