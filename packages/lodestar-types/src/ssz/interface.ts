import {
  BigIntUintType, BitListType, BooleanType, ByteVectorType,
  ContainerType, List, ListType, NumberUintType, Vector, VectorType,
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
  Uint8: NumberUintType;
  Uint16: NumberUintType;
  Uint32: NumberUintType;
  Number64: NumberUintType;
  Uint64: BigIntUintType;
  Uint128: BigIntUintType;
  Uint256: BigIntUintType;
  Slot: NumberUintType;
  Epoch: NumberUintType;
  CommitteeIndex: NumberUintType;
  ValidatorIndex: NumberUintType;
  Gwei: BigIntUintType;
  Root: ByteVectorType;
  Version: ByteVectorType;
  ForkDigest: ByteVectorType;
  BLSPubkey: ByteVectorType;
  BLSSignature: ByteVectorType;
  Domain: ByteVectorType;
  // misc
  Fork: ContainerType<t.Fork>;
  ForkData: ContainerType<t.ForkData>;
  Checkpoint: ContainerType<t.Checkpoint>;
  Validator: ContainerType<t.Validator>;
  AttestationData: ContainerType<t.AttestationData>;
  CommitteeIndices: ListType<List<t.ValidatorIndex>>;
  IndexedAttestation: ContainerType<t.IndexedAttestation>;
  CommitteeBits: BitListType;
  PendingAttestation: ContainerType<t.PendingAttestation>;
  Eth1Data: ContainerType<t.Eth1Data>;
  HistoricalBlockRoots: VectorType<Vector<t.Root>>;
  HistoricalStateRoots: VectorType<Vector<t.Root>>;
  HistoricalBatch: ContainerType<t.HistoricalBatch>;
  DepositMessage: ContainerType<t.DepositMessage>;
  DepositData: ContainerType<t.DepositData>;
  BeaconBlockHeader: ContainerType<t.BeaconBlockHeader>;
  SignedBeaconBlockHeader: ContainerType<t.SignedBeaconBlockHeader>;
  SigningRoot: ContainerType<t.SigningRoot>;
  DepositDataRootList: ContainerType<List<t.Root>>;
  // operations
  ProposerSlashing: ContainerType<t.ProposerSlashing>;
  AttesterSlashing: ContainerType<t.AttesterSlashing>;
  Attestation: ContainerType<t.Attestation>;
  Deposit: ContainerType<t.Deposit>;
  VoluntaryExit: ContainerType<t.VoluntaryExit>;
  SignedVoluntaryExit: ContainerType<t.SignedVoluntaryExit>;
  // block
  BeaconBlockBody: ContainerType<t.BeaconBlockBody>;
  BeaconBlock: ContainerType<t.BeaconBlock>;
  SignedBeaconBlock: ContainerType<t.SignedBeaconBlock>;
  // state
  EpochAttestations: ListType<List<t.PendingAttestation>>;
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
  BeaconBlocksByRootRequest: ContainerType<t.BeaconBlocksByRootRequest>;
  //api
  SubscribeToCommitteeSubnetPayload: ContainerType<t.SubscribeToCommitteeSubnetPayload>;
  ForkResponse: ContainerType<t.ForkResponse>;
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
  "ForkData",
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
  "DepositMessage",
  "DepositData",
  "BeaconBlockHeader",
  "SignedBeaconBlockHeader",
  "SigningRoot",
  "DepositDataRootList",
  // operations
  "ProposerSlashing",
  "AttesterSlashing",
  "Attestation",
  "Deposit",
  "VoluntaryExit",
  "SignedVoluntaryExit",
  // block
  "BeaconBlockBody",
  "BeaconBlock",
  "SignedBeaconBlock",
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
  "BeaconBlocksByRootRequest",
  //api
  "SubscribeToCommitteeSubnetPayload",
  "ForkResponse"
];
