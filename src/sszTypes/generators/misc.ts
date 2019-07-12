/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz";

import {IBeaconParams} from "../../params";
import {BeaconSSZTypes} from "../interface";

export const Fork = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "Fork",
  fields: [
    ["previousVersion", ssz.bytes4],
    ["currentVersion", ssz.bytes4],
    ["epoch", ssz.Epoch],
  ],
});

export const Crosslink = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "Crosslink",
  fields: [
    ["shard", ssz.number64],
    ["startEpoch", ssz.number64],
    ["endEpoch", ssz.number64],
    ["parentRoot", ssz.bytes32],
    ["dataRoot", ssz.bytes32],
  ],
});

export const Eth1Data = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "Eth1Data",
  fields: [
    ["depositRoot", ssz.bytes32],
    ["depositCount", ssz.number64],
    ["blockHash", ssz.bytes32],
  ],
});

export const AttestationData = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "AttestationData",
  fields: [
    ["beaconBlockRoot", ssz.bytes32],
    ["sourceEpoch", ssz.Epoch],
    ["sourceRoot", ssz.bytes32],
    ["targetEpoch", ssz.Epoch],
    ["targetRoot", ssz.bytes32],
    ["crosslink", ssz.Crosslink],
  ],
});

export const AttestationDataAndCustodyBit = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "AttestationDataAndCustodyBit",
  fields: [
    ["data", ssz.AttestationData],
    ["custodyBit", ssz.bool],
  ],
});

export const IndexedAttestation = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "IndexedAttestation",
  fields: [
    ["custodyBit0Indices", [ssz.ValidatorIndex]],
    ["custodyBit1Indices", [ssz.ValidatorIndex]],
    ["data", ssz.AttestationData],
    ["signature", ssz.BLSSignature],
  ],
});

export const DepositData = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "DepositData",
  fields: [
    ["pubkey", ssz.BLSPubkey],
    ["withdrawalCredentials", ssz.bytes32],
    ["amount", ssz.Gwei],
    ["signature", ssz.BLSSignature],
  ],
});

export const BeaconBlockHeader = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockHeader",
  fields: [
    ["slot", ssz.Slot],
    ["parentRoot", ssz.bytes32],
    ["stateRoot", ssz.bytes32],
    ["bodyRoot", ssz.bytes32],
    ["signature", ssz.BLSSignature],
  ],
});

export const Validator = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "Validator",
  fields: [
    ["pubkey", ssz.BLSPubkey],
    ["withdrawalCredentials", ssz.bytes32],
    ["activationEligibilityEpoch", ssz.Epoch],
    ["activationEpoch", ssz.Epoch],
    ["exitEpoch", ssz.Epoch],
    ["withdrawableEpoch", ssz.Epoch],
    ["slashed", ssz.bool],
    ["effectiveBalance", ssz.Gwei],
  ],
});

export const PendingAttestation = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "PendingAttestation",
  fields: [
    ["aggregationBitfield", ssz.bytes],
    ["data", ssz.AttestationData],
    ["inclusionDelay", ssz.number64],
    ["proposerIndex", ssz.ValidatorIndex],
  ],
});

export const HistoricalBatch = (ssz: BeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  name: "HistoricalBatch",
  fields: [
    ["blockRoots", [ssz.bytes32, params.SLOTS_PER_HISTORICAL_ROOT]],
    ["stateRoots", [ssz.bytes32, params.SLOTS_PER_HISTORICAL_ROOT]],
  ],
});

export const FFGData = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "FFGData",
  fields: [
    ["sourceEpoch", ssz.Epoch],
    ["sourceRoot", ssz.bytes32],
    ["targetEpoch", ssz.Epoch],
  ],
});

export const MerkleTree = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "MerkleTree",
  fields: [
    ["depth", ssz.number64],
    ["tree", [[ssz.bytes32]]]
  ]
});
