/**
 * @module sszTypes/generators
 */

import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {SimpleContainerType} from "@chainsafe/ssz-type-schema";

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
    ["root", ssz.Root],
  ],
});

export const Validator = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["pubkey", ssz.BLSPubkey],
    ["withdrawalCredentials", ssz.bytes32],
    ["effectiveBalance", ssz.Gwei],
    ["slashed", ssz.bool],
    ["activationEligibilityEpoch", ssz.Epoch],
    ["activationEpoch", ssz.Epoch],
    ["exitEpoch", ssz.Epoch],
    ["withdrawableEpoch", ssz.Epoch],
  ],
});

export const AttestationData = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["slot", ssz.Slot],
    ["index", ssz.CommitteeIndex],
    ["beaconBlockRoot", ssz.Root],
    ["source", ssz.Checkpoint],
    ["target", ssz.Checkpoint],
  ],
});

export const IndexedAttestation = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["attestingIndices", {
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
    ["depositRoot", ssz.Root],
    ["depositCount", ssz.number64],
    ["blockHash", ssz.bytes32],
  ],
});

export const HistoricalBatch = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["blockRoots", {
      elementType: ssz.Root,
      length: params.SLOTS_PER_HISTORICAL_ROOT,
    }],
    ["stateRoots", {
      elementType: ssz.Root,
      length: params.SLOTS_PER_HISTORICAL_ROOT,
    }],
  ],
});

export const DepositMessage = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["pubkey", ssz.BLSPubkey],
    ["withdrawalCredentials", ssz.bytes32],
    ["amount", ssz.Gwei],
  ],
});

export const DepositData = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["pubkey", ssz.BLSPubkey],
    ["withdrawalCredentials", ssz.bytes32],
    ["amount", ssz.Gwei],
    ["signature", ssz.BLSSignature],
  ],
});

export const BeaconBlockHeader = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["slot", ssz.Slot],
    ["parentRoot", ssz.Root],
    ["stateRoot", ssz.Root],
    ["bodyRoot", ssz.Root],
  ],
});

export const SignedBeaconBlockHeader = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["message", ssz.BeaconBlockHeader],
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
        elementType: ssz.bytes32,
        maxLength: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      },
      maxLength: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
    }]
  ]
});
