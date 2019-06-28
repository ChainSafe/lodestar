/*
import {BeaconBlockBody, BeaconBlockHeader, BeaconBlockRoot} from "./types";

export interface RpcBody {
  method_id: number;
  id: 1;
  body: request;
}

type request = Hello | Goodbye | GetStatus | GetBlockRoots | BlockRoots | GetBlockHeaders | BlockHeaders | GetBlockBodies | BlockBodies;

// 0x00
export interface Hello {
  networkId: number;
  chainId: number;
  latestFinalizedRoot: Buffer;
  latestFinalizedEpoch: number;
  bestRoot: Buffer;
  bestSlot: number;
}

// 0x01
export interface Goodbye {
  reason: number;
}

// 0x02
export interface GetStatus {
  sha: Buffer;
  userAgent: Buffer;
  timestamp: number;
}

// 0x0A
export interface GetBlockRoots {
  startRoot: Buffer;
  startSlot: number;
  max: number;
  skip: number;
  direction: number;
}

// 0x0B
export interface BlockRoots {
  roots: BeaconBlockRoot[];
}

// 0x0C
export interface GetBlockHeaders {
  startRoot: Buffer;
  startSlot: number;
  max: number;
  skip: number;
  direction: number;
}

// 0x0D
export interface BlockHeaders {
  headers: BeaconBlockHeader[];
}

// 0x0E
export interface GetBlockBodies {
  startRoot: Buffer;
  startSlot: number;
  max: number;
  skip: number;
  direction: number;
}

// 0x0F
export interface BlockBodies {
  blocks: BeaconBlockBody[];
}

*/

import {SimpleContainerType} from "@chainsafe/ssz";

import {Slot, bytes32, bytes, uint16, uint64, bytes8, Epoch, number64, uint8} from "../../../types/primitive";
import {BeaconBlock, BeaconBlockBody} from "../../../types/block";
import {BeaconBlockHeader} from "../../../types/misc";
import {BeaconState} from "../../../types/state";


export interface WireRequest {
  methodId: uint16;
  id: uint16;
  body: bytes;
}

export const WireRequest: SimpleContainerType = {
  name: "WireRequest",
  fields: [
    ["methodId", uint16],
    ["id", uint16],
    ["body", bytes],
  ],
};


export type RequestBody =
  Hello | Goodbye | GetStatus |
  GetBlockHeaders | GetBlockBodies | BlockHeaders | BlockBodies;


// Method ID: 0

export interface Hello {
  networkId: number64;
  chainId: uint16;
  latestFinalizedRoot: bytes32;
  latestFinalizedEpoch: Epoch;
  bestRoot: bytes32;
  bestSlot: Slot;
}
export const Hello: SimpleContainerType = {
  name: "Hello",
  fields: [
    ["networkId", number64],
    ["chainId", uint16],
    ["latestFinalizedRoot", bytes32],
    ["latestFinalizedEpoch", Epoch],
    ["bestRoot", bytes32],
    ["bestSlot", Slot],
  ],
};

// Method ID: 1

export interface Goodbye {
  reason: number64;
}
export const Goodbye: SimpleContainerType = {
  name: "Goodbye",
  fields: [
    ["reason", number64],
  ],
};

// Method ID: 2

export interface GetStatus {
  userAgent: bytes;
  timestamp: number64;
}
export const GetStatus: SimpleContainerType = {
  name: "GetStatus",
  fields: [
    ["userAgent", bytes],
    ["timestamp", number64],
  ],
};


// Method ID: 10

export interface GetBlockHeaders {
  startRoot: bytes32;
  startSlot: Slot;
  max: number64;
  skip: number64;
  direction: uint8;
}
export const GetBlockHeaders: SimpleContainerType = {
  name: "GetBlockHeaders",
  fields: [
    ["startRoot", bytes32],
    ["startSlot", Slot],
    ["max", number64],
    ["skip", number64],
    ["direction", uint8],
  ],
};

// Method ID: 11

export interface BlockHeaders {
  headers: BeaconBlockHeader[];
}
export const BlockHeaders: SimpleContainerType = {
  name: "BlockHeaders",
  fields: [
    ["headers", [BeaconBlockHeader]],
  ],
};

// Method ID: 12

export interface GetBlockBodies {
  startRoot: bytes32;
  startSlot: Slot;
  max: number64;
  skip: number64;
  direction: uint8;
}
export const GetBlockBodies: SimpleContainerType = {
  name: "GetBlockBodies",
  fields: [
    ["startRoot", bytes32],
    ["startSlot", Slot],
    ["max", number64],
    ["skip", number64],
    ["direction", uint8],
  ],
};

// Method ID: 13

export interface BlockBodies {
  bodies: BeaconBlock[];
}
export const BlockBodies: SimpleContainerType = {
  name: "BlockBodies",
  fields: [
    ["bodies", [BeaconBlock]],
  ],
};

