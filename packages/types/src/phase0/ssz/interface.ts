import {
  BigIntUintType,
  BitListType,
  BitVectorType,
  ContainerType,
  List,
  ListType,
  Vector,
  VectorType,
} from "@chainsafe/ssz";

import {IPrimitiveSSZTypes} from "../../primitive/IPrimitiveSSZTypes";
import * as phase0 from "../types";

export type IPhase0SSZTypes = IPrimitiveSSZTypes & {
  // misc
  Fork: ContainerType<phase0.Fork>;
  ForkData: ContainerType<phase0.ForkData>;
  ENRForkID: ContainerType<phase0.ENRForkID>;
  Checkpoint: ContainerType<phase0.Checkpoint>;
  SlotRoot: ContainerType<phase0.SlotRoot>;
  Validator: ContainerType<phase0.Validator>;
  AttestationData: ContainerType<phase0.AttestationData>;
  CommitteeIndices: ListType<List<phase0.ValidatorIndex>>;
  IndexedAttestation: ContainerType<phase0.IndexedAttestation>;
  CommitteeBits: BitListType;
  PendingAttestation: ContainerType<phase0.PendingAttestation>;
  Eth1Data: ContainerType<phase0.Eth1Data>;
  Eth1DataOrdered: ContainerType<phase0.Eth1DataOrdered>;
  HistoricalBlockRoots: VectorType<Vector<phase0.Root>>;
  HistoricalStateRoots: VectorType<Vector<phase0.Root>>;
  HistoricalBatch: ContainerType<phase0.HistoricalBatch>;
  DepositMessage: ContainerType<phase0.DepositMessage>;
  DepositData: ContainerType<phase0.DepositData>;
  DepositEvent: ContainerType<phase0.DepositEvent>;
  BeaconBlockHeader: ContainerType<phase0.BeaconBlockHeader>;
  SignedBeaconBlockHeader: ContainerType<phase0.SignedBeaconBlockHeader>;
  SigningData: ContainerType<phase0.SigningData>;
  DepositDataRootList: ContainerType<List<phase0.Root>>;
  AttestationSubnets: BitVectorType;
  // operations
  ProposerSlashing: ContainerType<phase0.ProposerSlashing>;
  AttesterSlashing: ContainerType<phase0.AttesterSlashing>;
  Attestation: ContainerType<phase0.Attestation>;
  Deposit: ContainerType<phase0.Deposit>;
  VoluntaryExit: ContainerType<phase0.VoluntaryExit>;
  SignedVoluntaryExit: ContainerType<phase0.SignedVoluntaryExit>;
  // block
  BeaconBlockBody: ContainerType<phase0.BeaconBlockBody>;
  BeaconBlock: ContainerType<phase0.BeaconBlock>;
  SignedBeaconBlock: ContainerType<phase0.SignedBeaconBlock>;
  // state
  EpochAttestations: ListType<List<phase0.PendingAttestation>>;
  BeaconState: ContainerType<phase0.BeaconState>;
  // Validator
  AggregateAndProof: ContainerType<phase0.AggregateAndProof>;
  SignedAggregateAndProof: ContainerType<phase0.SignedAggregateAndProof>;
  CommitteeAssignment: ContainerType<phase0.CommitteeAssignment>;
  SyncingStatus: ContainerType<phase0.SyncingStatus>;
  AttesterDuty: ContainerType<phase0.AttesterDuty>;
  ProposerDuty: ContainerType<phase0.ProposerDuty>;
  BeaconCommitteeSubscription: ContainerType<phase0.BeaconCommitteeSubscription>;
  // Validator slashing protection
  SlashingProtectionBlock: ContainerType<phase0.SlashingProtectionBlock>;
  SlashingProtectionAttestation: ContainerType<phase0.SlashingProtectionAttestation>;
  SlashingProtectionAttestationLowerBound: ContainerType<phase0.SlashingProtectionAttestationLowerBound>;
  // wire
  Status: ContainerType<phase0.Status>;
  Goodbye: BigIntUintType;
  Ping: BigIntUintType;
  Metadata: ContainerType<phase0.Metadata>;
  BeaconBlocksByRangeRequest: ContainerType<phase0.BeaconBlocksByRangeRequest>;
  BeaconBlocksByRootRequest: ContainerType<phase0.BeaconBlocksByRootRequest>;
  P2pErrorMessage: ListType<phase0.P2pErrorMessage>;
  //api
  SignedBeaconHeaderResponse: ContainerType<phase0.SignedBeaconHeaderResponse>;
  SubscribeToCommitteeSubnetPayload: ContainerType<phase0.SubscribeToCommitteeSubnetPayload>;
  Genesis: ContainerType<phase0.Genesis>;
  ChainHead: ContainerType<phase0.ChainHead>;
  BlockEventPayload: ContainerType<phase0.BlockEventPayload>;
  FinalizedCheckpoint: ContainerType<phase0.FinalizedCheckpoint>;
  ChainReorg: ContainerType<phase0.ChainReorg>;
  FinalityCheckpoints: ContainerType<phase0.FinalityCheckpoints>;
  ValidatorBalance: ContainerType<phase0.ValidatorBalance>;
  ValidatorResponse: ContainerType<phase0.ValidatorResponse>;
  BeaconCommitteeResponse: ContainerType<phase0.BeaconCommitteeResponse>;
  Contract: ContainerType<phase0.Contract>;
};

export const phase0TypeNames: (keyof IPhase0SSZTypes)[] = [
  // misc
  "Fork",
  "ForkData",
  "ENRForkID",
  "Checkpoint",
  "SlotRoot",
  "Validator",
  "AttestationData",
  "CommitteeIndices",
  "IndexedAttestation",
  "CommitteeBits",
  "PendingAttestation",
  "Eth1Data",
  "Eth1DataOrdered",
  "HistoricalBlockRoots",
  "HistoricalStateRoots",
  "HistoricalBatch",
  "DepositMessage",
  "DepositData",
  "DepositEvent",
  "BeaconBlockHeader",
  "SignedBeaconBlockHeader",
  "SigningData",
  "DepositDataRootList",
  "AttestationSubnets",
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
  "SignedAggregateAndProof",
  "CommitteeAssignment",
  // Validator slashing protection
  "SlashingProtectionBlock",
  "SlashingProtectionAttestation",
  "SlashingProtectionAttestationLowerBound",
  // wire
  "Status",
  "Goodbye",
  "Ping",
  "Metadata",
  "BeaconBlocksByRangeRequest",
  "BeaconBlocksByRootRequest",
  "P2pErrorMessage",
  // api
  "SignedBeaconHeaderResponse",
  "SubscribeToCommitteeSubnetPayload",
  "SyncingStatus",
  "AttesterDuty",
  "ProposerDuty",
  "BeaconCommitteeSubscription",
  "Genesis",
  "ChainHead",
  "BlockEventPayload",
  "FinalizedCheckpoint",
  "ChainReorg",
  "ValidatorBalance",
  "ValidatorResponse",
  "BeaconCommitteeResponse",
  "Contract",
];
