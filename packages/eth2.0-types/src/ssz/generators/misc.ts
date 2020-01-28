/**
 * @module sszTypes/generators
 */

import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {ContainerType, ListType, BitListType, VectorType, RootType} from "@chainsafe/ssz";

import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../constants";
import {IBeaconSSZTypes} from "../interface";

export const Fork = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    previousVersion: ssz.Version,
    currentVersion: ssz.Version,
    epoch: ssz.Epoch,
  },
});

export const Checkpoint = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    epoch: ssz.Epoch,
    root: ssz.Root,
  },
});

export const Validator = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    pubkey: ssz.BLSPubkey,
    withdrawalCredentials: ssz.Bytes32,
    effectiveBalance: ssz.Gwei,
    slashed: ssz.Boolean,
    activationEligibilityEpoch: ssz.Epoch,
    activationEpoch: ssz.Epoch,
    exitEpoch: ssz.Epoch,
    withdrawableEpoch: ssz.Epoch,
  },
});

export const AttestationData = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    slot: ssz.Slot,
    index: ssz.CommitteeIndex,
    beaconBlockRoot: ssz.Root,
    source: ssz.Checkpoint,
    target: ssz.Checkpoint,
  },
});

export const CommitteeIndices = (ssz: IBeaconSSZTypes, params: IBeaconParams): ListType => new ListType({
  elementType: ssz.ValidatorIndex,
  limit: params.MAX_VALIDATORS_PER_COMMITTEE,
});

export const IndexedAttestation = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    attestingIndices: ssz.CommitteeIndices,
    data: ssz.AttestationData,
    signature: ssz.BLSSignature,
  },
});

export const CommitteeBits = (ssz: IBeaconSSZTypes, params: IBeaconParams): BitListType => new BitListType({
  limit: params.MAX_VALIDATORS_PER_COMMITTEE,
});

export const PendingAttestation = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    aggregationBits: ssz.CommitteeBits,
    data: ssz.AttestationData,
    inclusionDelay: ssz.Slot,
    proposerIndex: ssz.ValidatorIndex,
  },
});

export const Eth1Data = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    depositRoot: ssz.Root,
    depositCount: ssz.Number64,
    blockHash: ssz.Bytes32,
  },
});

export const HistoricalBlockRoots = (ssz: IBeaconSSZTypes, params: IBeaconParams): VectorType => new VectorType({
  elementType: new RootType({expandedType: () => ssz.BeaconBlock}),
  length: params.SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalStateRoots = (ssz: IBeaconSSZTypes, params: IBeaconParams): VectorType => new VectorType({
  elementType: new RootType({expandedType: () => ssz.BeaconState}),
  length: params.SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalBatch = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    blockRoots: ssz.HistoricalBlockRoots,
    stateRoots: ssz.HistoricalStateRoots,
  },
});

export const DepositMessage = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    pubkey: ssz.BLSPubkey,
    withdrawalCredentials: ssz.Bytes32,
    amount: ssz.Gwei,
  },
});

export const DepositData = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    pubkey: ssz.BLSPubkey,
    withdrawalCredentials: ssz.Bytes32,
    amount: ssz.Gwei,
    signature: ssz.BLSSignature,
  },
});

export const BeaconBlockHeader = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    slot: ssz.Slot,
    parentRoot: ssz.Root,
    stateRoot: ssz.Root,
    bodyRoot: ssz.Root,
  },
});

export const SignedBeaconBlockHeader = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    message: ssz.BeaconBlockHeader,
    signature: ssz.BLSSignature,
  },
});

export const MerkleTree = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    depth: ssz.Number64,
    tree: new ListType({
      elementType: new ListType({
        elementType: ssz.Bytes32,
        limit: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      }),
      limit: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
    }),
  }
});
