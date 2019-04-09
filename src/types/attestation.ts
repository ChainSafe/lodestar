import { SimpleContainerType } from "@chainsafe/ssz";
// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts

import {
  bool,
  bytes,
  bytes32,
  bytes96,
  uint64,
} from "./primitive";

import {
  Epoch,
  Shard,
  Slot,
  ValidatorIndex,
} from "./custom";

export interface Crosslink {
  // Slot number
  epoch: Epoch;
  // Shard chain block hash
  shardBlockRoot: bytes32;
}

export const Crosslink: SimpleContainerType = {
  name: "Crosslink",
  fields: [
    ["epoch", Epoch],
    ["shardBlockRoot", bytes32],
  ],
};

export interface AttestationData {
  // Slot number
  slot: Slot;
  // Shard number
  shard: Shard;
  // Hash of the signed beacon block
  beaconBlockRoot: bytes32;
  // Hash of the ancestor at the epoch boundary
  epochBoundaryRoot: bytes32;
  // Shard block hash being attested to
  shardBlockRoot: bytes32;
  // Last crosslink hash
  latestCrosslink: Crosslink;
  // Slot of the last justified beacon block
  justifiedEpoch: Epoch;
  // Hash of the last justified beacon block
  justifiedBlockRoot: bytes32;
}
export const AttestationData: SimpleContainerType = {
  name: "AttestationData",
  fields: [
    ["slot", Slot],
    ["shard", Shard],
    ["beaconBlockRoot", bytes32],
    ["epochBoundaryRoot", bytes32],
    ["shardBlockRoot", bytes32],
    ["latestCrosslink", Crosslink],
    ["justifiedEpoch", Epoch],
    ["justifiedBlockRoot", bytes32],
  ],
};

export interface Attestation {
  // Attester participation bitfield
  aggregationBitfield: bytes;
  // Attestation data
  data: AttestationData;
  // Proof of custody bitfield
  custodyBitfield: bytes;
  // BLS aggregate signature
  aggregateSignature: bytes96;
}
export const Attestation: SimpleContainerType = {
  name: "Attestation",
  fields: [
    ["aggregationBitfield", bytes],
    ["data", AttestationData],
    ["custodyBitfield", bytes],
    ["aggregateSignature", bytes96],
  ],
};

export interface AttestationDataAndCustodyBit {
  // Attestation data
  data: AttestationData;
  // Custody bit
  custodyBit: bool;
}
export const AttestationDataAndCustodyBit: SimpleContainerType = {
  name: "AttestationDataAndCustodyBit",
  fields: [
    ["data", AttestationData],
    ["custodyBit", bool],
  ],
};

export interface PendingAttestation {
  // Proof of custody bitfield
  aggregationBitfield: bytes;
  // Signed data
  data: AttestationData;
  // Attester participation bitfield
  custodyBitfield: bytes;
  // Slot in which it was included
  inclusionSlot: Slot;
}
export const PendingAttestation: SimpleContainerType = {
  name: "PendingAttestation",
  fields: [
    ["aggregationBitfield", bytes],
    ["data", AttestationData],
    ["custodyBitfield", bytes],
    ["inclusionSlot", Slot],
  ],
};

export interface SlashableAttestation {
  // Validator Indices
  validatorIndices: ValidatorIndex[];
  // Attestation Data
  data: AttestationData;
  // Custody Bitfield
  custodyBitfield: bytes;
  // Aggregate signature
  aggregateSignature: bytes96;
}
export const SlashableAttestation: SimpleContainerType = {
  name: "SlashableAttestation",
  fields: [
    ["validatorIndices", [ValidatorIndex]],
    ["data", AttestationData],
    ["custodyBitfield", bytes],
    ["aggregateSignature", bytes96],
  ],
};

export interface AttesterSlashing {
  // First slashable attestation
  slashableAttestation1: SlashableAttestation;
  // Second slashable attestation
  slashableAttestation2: SlashableAttestation;
}
export const AttesterSlashing: SimpleContainerType = {
  name: "AttesterSlashing",
  fields: [
    ["slashableAttestation1", SlashableAttestation],
    ["slashableAttestation2", SlashableAttestation],
  ],
};

