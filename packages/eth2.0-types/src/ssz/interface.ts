import {
  BigIntUintType, BitListType, BooleanType, ByteVectorType, ContainerType, ListType, NumberUintType, VectorType,
} from "@chainsafe/ssz";

import * as t from "../types";

export interface IBeaconSSZTypes {
  // primitive
  Boolean: BooleanType;
  Bytes4: ByteVectorType;
  Bytes8: ByteVectorType;
  Bytes32: ByteVectorType;
  Bytes48: ByteVectorType;
  Bytes96: ByteVectorType;
  Uint16: NumberUintType;
  Number64: NumberUintType;
  Uint64: BigIntUintType;
  Uint256: BigIntUintType;
  Slot: NumberUintType;
  Epoch: NumberUintType;
  CommitteeIndex: NumberUintType;
  ValidatorIndex: NumberUintType;
  Gwei: BigIntUintType;
  Root: ByteVectorType;
  Version: ByteVectorType;
  BLSPubkey: ByteVectorType;
  BLSSignature: ByteVectorType;
  // misc
  Fork: ContainerType<t.Fork>;
  Checkpoint: ContainerType<t.Checkpoint>;
  Validator: ContainerType<t.Validator>;
  AttestationData: ContainerType<t.AttestationData>;
  CommitteeIndices: ListType<ArrayLike<t.ValidatorIndex>>;
  IndexedAttestation: ContainerType<t.IndexedAttestation>;
  CommitteeBits: BitListType;
  PendingAttestation: ContainerType<t.PendingAttestation>;
  Eth1Data: ContainerType<t.Eth1Data>;
  HistoricalBlockRoots: VectorType<ArrayLike<t.Root>>;
  HistoricalStateRoots: VectorType<ArrayLike<t.Root>>;
  HistoricalBatch: ContainerType<t.HistoricalBatch>;
  DepositData: ContainerType<t.DepositData>;
  BeaconBlockHeader: ContainerType<t.BeaconBlockHeader>;
  MerkleTree: ContainerType<t.MerkleTree>;
  // operations
  ProposerSlashing: ContainerType<t.ProposerSlashing>;
  AttesterSlashing: ContainerType<t.AttesterSlashing>;
  Attestation: ContainerType<t.Attestation>;
  Deposit: ContainerType<t.Deposit>;
  VoluntaryExit: ContainerType<t.VoluntaryExit>;
  // block
  BeaconBlockBody: ContainerType<t.BeaconBlockBody>;
  BeaconBlock: ContainerType<t.BeaconBlock>;
  // state
  EpochAttestations: ListType<ArrayLike<t.PendingAttestation>>;
  BeaconState: ContainerType<t.BeaconState>;
  // Validator
  AggregateAndProof: ContainerType<t.AggregateAndProof>;
  CommitteeAssignment: ContainerType<t.CommitteeAssignment>;
  SyncingStatus: ContainerType<t.SyncingStatus>;
  ValidatorDuty: ContainerType<t.ValidatorDuty>;
  // wire
  Status: ContainerType<t.Status>;
  Goodbye: BigIntUintType;
  BeaconBlocksByRangeRequest: ContainerType<t.BeaconBlocksByRangeRequest>;
  BeaconBlocksByRangeResponse: ContainerType<t.BeaconBlocksByRangeResponse>;
  BeaconBlocksByRootRequest: ContainerType<t.BeaconBlocksByRootRequest>;
  BeaconBlocksByRootResponse: ContainerType<t.BeaconBlocksByRootResponse>;
}

export const typeNames: (keyof IBeaconSSZTypes)[] = [
  // primitive
  /*
  "Boolean",
  "Bytes4",
  "Bytes8",
  "Bytes32",
  "Bytes48",
  "Bytes96",
  "Uint16",
  "Number64",
  "Uint64",
  "Uint256",
  "Slot",
  "Epoch",
  "CommitteeIndex",
  "ValidatorIndex",
  "Gwei",
  "BLSPubkey",
  "BLSSignature",
   */
  // misc
  "Fork",
  "Checkpoint",
  "Validator",
  "AttestationData",
  "CommitteeIndices",
  "IndexedAttestation",
  "CommitteeBits",
  "PendingAttestation",
  "Eth1Data",
  "HistoricalBlockRoots",
  "HistoricalStateRoots",
  "HistoricalBatch",
  "DepositData",
  "BeaconBlockHeader",
  "MerkleTree",
  // operations
  "ProposerSlashing",
  "AttesterSlashing",
  "Attestation",
  "Deposit",
  "VoluntaryExit",
  // block
  "BeaconBlockBody",
  "BeaconBlock",
  // state
  "EpochAttestations",
  "BeaconState",
  //validator
  "AggregateAndProof",
  "CommitteeAssignment",
  "SyncingStatus",
  "ValidatorDuty",
  // wire
  "Status",
  "Goodbye",
  "BeaconBlocksByRangeRequest",
  "BeaconBlocksByRangeResponse",
  "BeaconBlocksByRootRequest",
  "BeaconBlocksByRootResponse",
];
