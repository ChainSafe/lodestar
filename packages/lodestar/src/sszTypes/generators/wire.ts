/**
 * @module sszTypes/generators
 * */
import {SimpleContainerType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";

export const BlockRootSlot = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BlockRootSlot",
  fields: [
    ["blockRoot", ssz.bytes32],
    ["slot", ssz.Slot],
  ],
});

export const WireRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "WireRequest",
  fields: [
    ["id", ssz.bytes8],
    ["method", ssz.uint16],
    ["body", ssz.bytes],
  ],
});

export const WireResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "Response",
  fields: [
    ["id", ssz.bytes8],
    ["responseCode", ssz.uint16],
    ["result", ssz.bytes],
  ],
});

// Method ID: 0

export const Hello = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "Hello",
  fields: [
    ["networkId", ssz.uint64],
    ["chainId", ssz.uint16],
    ["latestFinalizedRoot", ssz.bytes32],
    ["latestFinalizedEpoch", ssz.Epoch],
    ["bestRoot", ssz.bytes32],
    ["bestSlot", ssz.Slot],
  ],
});

// Method ID: 1

export const Goodbye = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "Goodbye",
  fields: [
    ["reason", ssz.uint64],
  ],
});

// Method ID: 2

export const Status = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "Status",
  fields: [
    ["sha", ssz.bytes32],
    ["userAgent", ssz.bytes],
    ["timestamp", ssz.number64],
  ],
});

// Method ID: 10

export const BeaconBlockRootsRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockRootsRequest",
  fields: [
    ["startSlot", ssz.Slot],
    ["count", ssz.number64],
  ],
});

export const BeaconBlockRootsResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockRootsResponse",
  fields: [
    ["roots", [ssz.BlockRootSlot]],
  ],
});

// Method ID: 11

export const BeaconBlockHeadersRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockHeadersRequest",
  fields: [
    ["startRoot", ssz.bytes32],
    ["startSlot", ssz.Slot],
    ["maxHeaders", ssz.number64],
    ["skipSlots", ssz.number64],
  ],
});

export const BeaconBlockHeadersResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockHeadersResponse",
  fields: [
    ["headers", [ssz.BeaconBlockHeader]],
  ],
});

// Method ID: 12

export const BeaconBlockBodiesRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockBodiesRequest",
  fields: [
    ["blockRoots", [ssz.bytes32]],
  ],
});

export const BeaconBlockBodiesResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockBodiesResponse",
  fields: [
    ["blockBodies", [ssz.BeaconBlockBody]],
  ],
});

// Method ID: 13

export const BeaconStatesRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconStatesRequest",
  fields: [
    ["hashes", [ssz.bytes32]],
  ],
});

export const BeaconStatesResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconStatesResponse",
  fields: [
    ["states", [ssz.BeaconState]],
  ],
});



// for hobbits
export const HobbitsHello = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "Hello",
  fields: [
    ["networkId", ssz.uint8],
    ["chainId", ssz.uint8],
    ["latestFinalizedRoot", ssz.bytes32],
    ["latestFinalizedEpoch", ssz.uint64],
    ["bestRoot", ssz.bytes32],
    ["bestSlot", ssz.uint64],
  ],
});

export const HobbitsStatus = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "Status",
  fields: [
    ["userAgent", ssz.bytes],
    ["timestamp", ssz.uint64],
  ],
});

export const HobbitsGetBlockHeaders = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockHeadersRequest",
  fields: [
    ["startRoot", ssz.bytes32],
    ["startSlot", ssz.uint64],
    ["max", ssz.uint64],
    ["skip", ssz.uint64],
    ["direction", ssz.uint8],
  ],
});


export const HobbitsGetBlockBodies = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "HobbitsGetBlockBodies",
  fields: [
    ["startRoot", ssz.bytes32],
    ["startSlot", ssz.uint64],
    ["max", ssz.uint64],
    ["skip", ssz.uint64],
    ["direction", ssz.uint8],
  ],
});

export const HobbitsBlockBodies = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockBodiesResponse",
  fields: [
    ["bodies", [ssz.BeaconBlockBody]],
  ],
});


export const HobbitsGetAttestation = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "HobbitsGetAttestation",
  fields: [
    ["hash", ssz.bytes],
  ],
});


export const HobbitsAttestation = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "HobbitsAttestation",
  fields: [
    ["attestation", ssz.Attestation],
  ],
});





