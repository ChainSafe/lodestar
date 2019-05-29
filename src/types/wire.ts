import {SimpleContainerType} from "@chainsafe/ssz";

import {Slot, bytes32, bytes, uint16, uint64, bytes8, Epoch, number64} from "./primitive";
import {BeaconBlockBody} from "./block";
import {BeaconBlockHeader} from "./misc";
import {BeaconState} from "./state";

export interface BlockRootSlot {
  blockRoot: bytes32;
  slot: Slot;
}
export const BlockRootSlot: SimpleContainerType = {
  name: "BlockRootSlot",
  fields: [
    ["blockRoot", bytes32],
    ["slot", Slot],
  ],
};

export interface WireRequest {
  id: bytes8;
  method: uint16;
  body: bytes;
}
export const WireRequest: SimpleContainerType = {
  name: "WireRequest",
  fields: [
    ["id", bytes8],
    ["method", uint16],
    ["body", bytes],
  ],
};

export interface WireResponse {
  id: bytes8;
  responseCode: uint16;
  result: bytes;
}
export const WireResponse: SimpleContainerType = {
  name: "Response",
  fields: [
    ["id", bytes8],
    ["responseCode", uint16],
    ["result", bytes],
  ],
};

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
  latestFinalizedRoot: bytes32;
  latestFinalizedEpoch: Epoch;
  bestRoot: bytes32;
  bestSlot: Slot;
}
export const Hello: SimpleContainerType = {
  name: "Hello",
  fields: [
    ["networkId", uint64],
    ["chainId", uint16],
    ["latestFinalizedRoot", bytes32],
    ["latestFinalizedEpoch", Epoch],
    ["bestRoot", bytes32],
    ["bestSlot", Slot],
  ],
};

// Method ID: 1

export interface Goodbye {
  reason: uint64;
}
export const Goodbye: SimpleContainerType = {
  name: "Goodbye",
  fields: [
    ["reason", uint64],
  ],
};

// Method ID: 2

export interface Status {
  sha: bytes32;
  userAgent: bytes;
  timestamp: number64;
}
export const Status: SimpleContainerType = {
  name: "Status",
  fields: [
    ["sha", bytes32],
    ["userAgent", bytes],
    ["timestamp", number64],
  ],
};

// Method ID: 10

export interface BeaconBlockRootsRequest {
  startSlot: Slot;
  count: number64;
}
export const BeaconBlockRootsRequest: SimpleContainerType = {
  name: "BeaconBlockRootsRequest",
  fields: [
    ["startSlot", Slot],
    ["count", number64],
  ],
};

export interface BeaconBlockRootsResponse {
  blockRoot: bytes32;
  slot: Slot;
  roots: BlockRootSlot[];
}
export const BeaconBlockRootsResponse: SimpleContainerType = {
  name: "BeaconBlockRootsResponse",
  fields: [
    ["blockRoot", bytes32],
    ["slot", Slot],
    ["roots", [BlockRootSlot]],
  ],
};

// Method ID: 11

export interface BeaconBlockHeadersRequest {
  startRoot: bytes32; 
  startSlot: Slot;
  maxHeaders: number64;
  skipSlots: number64;
}
export const BeaconBlockHeadersRequest: SimpleContainerType = {
  name: "BeaconBlockHeadersRequest",
  fields: [
    ["startRoot", bytes32],
    ["startSlot", Slot],
    ["maxHeaders", number64],
    ["skipSlots", number64],
  ],
};

export interface BeaconBlockHeadersResponse {
  headers: BeaconBlockHeader[];
}
export const BeaconBlockHeadersResponse: SimpleContainerType = {
  name: "BeaconBlockHeadersResponse",
  fields: [
    ["headers", [BeaconBlockHeader]],
  ],
};

// Method ID: 12

export interface BeaconBlockBodiesRequest {
  blockRoots: bytes32[];
} 
export const BeaconBlockBodiesRequest: SimpleContainerType = {
  name: "BeaconBlockBodiesRequest",
  fields: [
    ["blockRoots", [bytes32]],
  ],
};

export interface BeaconBlockBodiesResponse {
  blockBodies: BeaconBlockBody[];
}
export const BeaconBlockBodiesResponse: SimpleContainerType = {
  name: "BeaconBlockBodiesResponse",
  fields: [
    ["blockBodies", [BeaconBlockBody]],
  ],
};

// Method ID: 13

export interface BeaconStatesRequest {
  hashes: bytes32[];
}
export const BeaconStatesRequest: SimpleContainerType = {
  name: "BeaconStatesRequest",
  fields: [
    ["hashes", [bytes32]],
  ],
};

export interface BeaconStatesResponse {
  states: BeaconState[];
}
export const BeaconStatesResponse: SimpleContainerType = {
  name: "BeaconStatesResponse",
  fields: [
    ["states", [BeaconState]],
  ],
};
