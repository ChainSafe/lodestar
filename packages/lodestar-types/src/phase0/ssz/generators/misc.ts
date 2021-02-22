/**
 * @module sszTypes/generators
 */

import {IPhase0Params} from "@chainsafe/lodestar-params";
import {ContainerType, ListType, BitListType, VectorType, RootType, BitVectorType} from "@chainsafe/ssz";

import {DEPOSIT_CONTRACT_TREE_DEPTH, ATTESTATION_SUBNET_COUNT} from "../constants";
import {IPhase0SSZTypes} from "../interface";

export const Fork = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      previousVersion: ssz.Version,
      currentVersion: ssz.Version,
      epoch: ssz.Epoch,
    },
  });

export const ForkData = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      currentVersion: ssz.Version,
      genesisValidatorsRoot: ssz.Root,
    },
  });

export const ENRForkID = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      forkDigest: ssz.ForkDigest,
      nextForkVersion: ssz.Version,
      nextForkEpoch: ssz.Epoch,
    },
  });

export const Checkpoint = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      epoch: ssz.Epoch,
      root: ssz.Root,
    },
  });

export const SlotRoot = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      root: ssz.Root,
    },
  });

export const Validator = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
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

export const AttestationData = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      index: ssz.CommitteeIndex,
      beaconBlockRoot: ssz.Root,
      source: ssz.Checkpoint,
      target: ssz.Checkpoint,
    },
  });

export const CommitteeIndices = (ssz: IPhase0SSZTypes, params: IPhase0Params): ListType =>
  new ListType({
    elementType: ssz.ValidatorIndex,
    limit: params.MAX_VALIDATORS_PER_COMMITTEE,
  });

export const IndexedAttestation = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      attestingIndices: ssz.CommitteeIndices,
      data: ssz.AttestationData,
      signature: ssz.BLSSignature,
    },
  });

export const CommitteeBits = (ssz: IPhase0SSZTypes, params: IPhase0Params): BitListType =>
  new BitListType({
    limit: params.MAX_VALIDATORS_PER_COMMITTEE,
  });

export const PendingAttestation = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      aggregationBits: ssz.CommitteeBits,
      data: ssz.AttestationData,
      inclusionDelay: ssz.Slot,
      proposerIndex: ssz.ValidatorIndex,
    },
  });

export const Eth1Data = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      depositRoot: ssz.Root,
      depositCount: ssz.Number64,
      blockHash: ssz.Bytes32,
    },
  });

export const Eth1DataOrdered = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      depositRoot: ssz.Root,
      depositCount: ssz.Number64,
      blockHash: ssz.Bytes32,
      blockNumber: ssz.Number64,
    },
  });

export const HistoricalBlockRoots = (ssz: IPhase0SSZTypes, params: IPhase0Params): VectorType =>
  new VectorType({
    elementType: new RootType({expandedType: () => ssz.BeaconBlock}),
    length: params.SLOTS_PER_HISTORICAL_ROOT,
  });

export const HistoricalStateRoots = (ssz: IPhase0SSZTypes, params: IPhase0Params): VectorType =>
  new VectorType({
    elementType: new RootType({expandedType: () => ssz.BeaconState}),
    length: params.SLOTS_PER_HISTORICAL_ROOT,
  });

export const HistoricalBatch = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      blockRoots: ssz.HistoricalBlockRoots,
      stateRoots: ssz.HistoricalStateRoots,
    },
  });

export const DepositMessage = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      pubkey: ssz.BLSPubkey,
      withdrawalCredentials: ssz.Bytes32,
      amount: ssz.Gwei,
    },
  });

export const DepositData = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      pubkey: ssz.BLSPubkey,
      withdrawalCredentials: ssz.Bytes32,
      amount: ssz.Gwei,
      signature: ssz.BLSSignature,
    },
  });

export const DepositEvent = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      depositData: ssz.DepositData,
      blockNumber: ssz.Number64,
      index: ssz.Number64,
    },
  });

export const BeaconBlockHeader = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      proposerIndex: ssz.ValidatorIndex,
      parentRoot: ssz.Root,
      stateRoot: ssz.Root,
      bodyRoot: ssz.Root,
    },
  });

export const SignedBeaconBlockHeader = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      message: ssz.BeaconBlockHeader,
      signature: ssz.BLSSignature,
    },
  });

export const SigningData = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      objectRoot: ssz.Root,
      domain: ssz.Domain,
    },
  });

export const DepositDataRootList = (ssz: IPhase0SSZTypes): ListType =>
  new ListType({
    elementType: new RootType({
      expandedType: ssz.DepositData,
    }),
    limit: 2 ** DEPOSIT_CONTRACT_TREE_DEPTH,
  });

export const AttestationSubnets = (): BitVectorType =>
  new BitVectorType({
    length: ATTESTATION_SUBNET_COUNT,
  });
