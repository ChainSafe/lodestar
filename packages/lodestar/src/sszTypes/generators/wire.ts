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
