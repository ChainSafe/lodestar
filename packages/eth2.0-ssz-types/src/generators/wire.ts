/**
 * @module sszTypes/generators
 * */
import {SimpleContainerType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";

export const BlockRootSlot = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["blockRoot", ssz.Hash],
    ["slot", ssz.Slot],
  ],
});

export const WireRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["id", ssz.bytes8],
    ["method", ssz.uint16],
    ["body", {
      elementType: ssz.uint8,
      maxLength: 32000,
    }],
  ],
});

export const WireResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["id", ssz.bytes8],
    ["responseCode", ssz.uint16],
    ["result", {
      elementType: ssz.uint8,
      maxLength: 32000,
    }],
  ],
});

// Method ID: 0

export const Hello = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["networkId", ssz.uint64],
    ["chainId", ssz.uint16],
    ["latestFinalizedRoot", ssz.bytes32],
    ["latestFinalizedEpoch", ssz.Epoch],
    ["bestRoot", ssz.Hash],
    ["bestSlot", ssz.Slot],
  ],
});

// Method ID: 1

export const Goodbye = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["reason", ssz.uint64],
  ],
});

// Method ID: 2

export const Status = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["sha", ssz.bytes32],
    ["userAgent", {
      elementType: ssz.uint8,
      maxLength: 32000,
    }],
    ["timestamp", ssz.number64],
  ],
});

// Method ID: 10

export const BeaconBlockRootsRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["startSlot", ssz.Slot],
    ["count", ssz.number64],
  ],
});

export const BeaconBlockRootsResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["roots", {
      elementType: ssz.BlockRootSlot,
      maxLength: 32000,
    }],
  ],
});

// Method ID: 11

export const BeaconBlockHeadersRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["startRoot", ssz.Hash],
    ["startSlot", ssz.Slot],
    ["maxHeaders", ssz.number64],
    ["skipSlots", ssz.number64],
  ],
});

export const BeaconBlockHeadersResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["headers", {
      elementType: ssz.BeaconBlockHeader,
      maxLength: 32000,
    }],
  ],
});

// Method ID: 12

export const BeaconBlockBodiesRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["blockRoots", {
      elementType: ssz.Hash,
      maxLength: 32000,
    }],
  ],
});

export const BeaconBlockBodiesResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["blockBodies", {
      elementType: ssz.BeaconBlockBody,
      maxLength: 32000,
    }],
  ],
});

// Method ID: 13

export const BeaconStatesRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["hashes", {
      elementType: ssz.Hash,
      maxLength: 32000,
    }],
  ],
});

export const BeaconStatesResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["states", {
      elementType: ssz.BeaconState,
      maxLength: 32000,
    }],
  ],
});



// for hobbits
export const HobbitsHello = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
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
  fields: [
    ["userAgent", {
      elementType: ssz.uint8,
      maxLength: 32000,
    }], // was bytes
    ["timestamp", ssz.uint64],
  ],
});

export const HobbitsGetBlockHeaders = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["startRoot", ssz.bytes32],
    ["startSlot", ssz.uint64],
    ["max", ssz.uint64],
    ["skip", ssz.uint64],
    ["direction", ssz.uint8],
  ],
});


export const HobbitsGetBlockBodies = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["startRoot", ssz.bytes32],
    ["startSlot", ssz.uint64],
    ["max", ssz.uint64],
    ["skip", ssz.uint64],
    ["direction", ssz.uint8],
  ],
});

export const HobbitsBlockBodies = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["bodies", {
      elementType: ssz.BeaconBlockBody,
      maxLength: 32000,
    }],
  ],
});


export const HobbitsGetAttestation = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["hash", ssz.bytes32], // was bytes
  ],
});


export const HobbitsAttestation = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["attestation", ssz.Attestation],
  ],
});





