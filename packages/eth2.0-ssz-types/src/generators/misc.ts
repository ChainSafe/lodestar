/**
 * @module sszTypes/generators
 */

import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {SimpleContainerType} from "@chainsafe/ssz";

import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../constants";
import {IBeaconSSZTypes} from "../interface";

export const Fork = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["previousVersion", ssz.Version],
    ["currentVersion", ssz.Version],
    ["epoch", ssz.Epoch],
  ],
});

export const Checkpoint = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["epoch", ssz.Epoch],
    ["root", ssz.Hash],
  ],
});

export const Validator = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["pubkey", ssz.BLSPubkey],
    ["withdrawalCredentials", ssz.Hash],
    ["effectiveBalance", ssz.Gwei],
    ["slashed", ssz.bool],
    ["activationEligibilityEpoch", ssz.Epoch],
    ["activationEpoch", ssz.Epoch],
    ["exitEpoch", ssz.Epoch],
    ["withdrawableEpoch", ssz.Epoch],
  ],
});

export const Crosslink = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["shard", ssz.Shard],
    ["parentRoot", ssz.Hash],
    ["startEpoch", ssz.Epoch],
    ["endEpoch", ssz.Epoch],
    ["dataRoot", ssz.Hash],
  ],
});

export const AttestationData = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["beaconBlockRoot", ssz.Hash],
    ["source", ssz.Checkpoint],
    ["target", ssz.Checkpoint],
    ["crosslink", ssz.Crosslink],
  ],
});

export const AttestationDataAndCustodyBit = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["data", ssz.AttestationData],
    ["custodyBit", ssz.bool],
  ],
});

export const IndexedAttestation = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["custodyBit0Indices", {
      elementType: ssz.ValidatorIndex,
      maxLength: params.MAX_VALIDATORS_PER_COMMITTEE,
    }],
    ["custodyBit1Indices", {
      elementType: ssz.ValidatorIndex,
      maxLength: params.MAX_VALIDATORS_PER_COMMITTEE,
    }],
    ["data", ssz.AttestationData],
    ["signature", ssz.BLSSignature],
  ],
});

export const PendingAttestation = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["aggregationBits", {
      elementType: ssz.bool,
      maxLength: params.MAX_VALIDATORS_PER_COMMITTEE,
    }],
    ["data", ssz.AttestationData],
    ["inclusionDelay", ssz.Slot],
    ["proposerIndex", ssz.ValidatorIndex],
  ],
});

export const Eth1Data = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["depositRoot", ssz.Hash],
    ["depositCount", ssz.number64],
    ["blockHash", ssz.Hash],
  ],
});

export const HistoricalBatch = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["blockRoots", {
      elementType: ssz.bytes32,
      length: params.SLOTS_PER_HISTORICAL_ROOT,
    }],
    ["stateRoots", {
      elementType: ssz.bytes32,
      length: params.SLOTS_PER_HISTORICAL_ROOT,
    }],
  ],
});

export const DepositData = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["pubkey", ssz.BLSPubkey],
    ["withdrawalCredentials", ssz.Hash],
    ["amount", ssz.Gwei],
    ["signature", ssz.BLSSignature],
  ],
});

export const CompactCommittee = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["pubkeys", {
      elementType: ssz.BLSPubkey,
      maxLength: params.MAX_VALIDATORS_PER_COMMITTEE,
    }],
    ["compactValidators", {
      elementType: ssz.uint64,
      maxLength: params.MAX_VALIDATORS_PER_COMMITTEE,
    }],
  ],
});

export const BeaconBlockHeader = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["slot", ssz.Slot],
    ["parentRoot", ssz.Hash],
    ["stateRoot", ssz.Hash],
    ["bodyRoot", ssz.Hash],
    ["signature", ssz.BLSSignature],
  ],
});

export const FFGData = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["source", ssz.Checkpoint],
    ["target", ssz.Checkpoint],
  ],
});

export const MerkleTree = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["depth", ssz.number64],
    ["tree", {
      elementType: {
        elementType: ssz.Hash,
        maxLength: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      },
      maxLength: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
    }]
  ]
});
