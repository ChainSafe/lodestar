/**
 * @module network/hobbits/rpc
 */


import {SimpleContainerType} from "@chainsafe/ssz";

import {Slot, bytes32, bytes, uint16, uint64, bytes8, Epoch, number64, uint8} from "../../../types/primitive";
import {BeaconBlock, BeaconBlockBody} from "../../../types/block";
import {BeaconBlockHeader} from "../../../types/misc";
import {BeaconState} from "../../../types/state";
import {Attestation} from "../../../types";


/*export interface WireRequestHeader {
  methodId: uint16;
  id: number;
}

// export const WireRequestHeader: SimpleContainerType = {
//   name: "WireRequestHeader",
//   fields: [
//     ["method_id", uint16],
//     ["id", number64],
//   ],
// };

export interface WireRequestBody {
  body: bytes;
}*/

// export const WireRequestBody: SimpleContainerType = {
//   name: "WireRequestBody",
//   fields: [
//     ["body", bytes],
//   ],
// };


/*
export type RequestBody =
  Hello | Goodbye | GetStatus | GetBlockHeaders | GetBlockBodies
  | BlockHeaders | BlockBodies | GetAttestation | AttestationResponse;

// May need to change or delete altogether
export type ResponseBody = RequestBody;
// export type WireResponse = WireRequest;

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
    ["network_id", number64],
    ["chain_id", uint16],
    ["latest_finalized_root", bytes32],
    ["latest_finalized_epoch", Epoch],
    ["best_root", bytes32],
    ["best_slot", Slot],
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
    ["user_agent", bytes],
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
    ["start_root", bytes32],
    ["start_slot", Slot],
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
    ["start_root", bytes32],
    ["start_slot", Slot],
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

// Method ID: 14

export interface GetAttestation {
  signature: bytes;
}
export const GetAttestation: SimpleContainerType = {
  name: "GetAttestation",
  fields: [
    ["signature", bytes],
  ],
};

// Method ID: 15

export interface AttestationResponse {
  attestation: Attestation;
}
export const AttestationResponse: SimpleContainerType = {
  name: "AttestationResponse",
  fields: [
    ["attestation", Attestation],
  ],
};*/
