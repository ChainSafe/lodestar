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

export type IPhase0SSZTypes = IPhase0SSZTypesOnly & IPrimitiveSSZTypes;
export type IPhase0SSZTypesOnly = {
  // misc
  AttestationSubnets: BitVectorType;
  BeaconBlockHeader: ContainerType<phase0.BeaconBlockHeader>;
  SignedBeaconBlockHeader: ContainerType<phase0.SignedBeaconBlockHeader>;
  Checkpoint: ContainerType<phase0.Checkpoint>;
  CommitteeBits: BitListType;
  CommitteeIndices: ListType<List<phase0.ValidatorIndex>>;
  DepositMessage: ContainerType<phase0.DepositMessage>;
  DepositData: ContainerType<phase0.DepositData>;
  DepositDataRootList: ListType<List<phase0.Root>>;
  DepositEvent: ContainerType<phase0.DepositEvent>;
  Eth1Data: ContainerType<phase0.Eth1Data>;
  Eth1DataOrdered: ContainerType<phase0.Eth1DataOrdered>;
  Fork: ContainerType<phase0.Fork>;
  ForkData: ContainerType<phase0.ForkData>;
  ENRForkID: ContainerType<phase0.ENRForkID>;
  HistoricalBlockRoots: VectorType<Vector<phase0.Root>>;
  HistoricalStateRoots: VectorType<Vector<phase0.Root>>;
  HistoricalBatch: ContainerType<phase0.HistoricalBatch>;
  SlotRoot: ContainerType<phase0.SlotRoot>;
  Validator: ContainerType<phase0.Validator>;
  AttestationData: ContainerType<phase0.AttestationData>;
  IndexedAttestation: ContainerType<phase0.IndexedAttestation>;
  PendingAttestation: ContainerType<phase0.PendingAttestation>;
  SigningData: ContainerType<phase0.SigningData>;
  // operations
  Attestation: ContainerType<phase0.Attestation>;
  AttesterSlashing: ContainerType<phase0.AttesterSlashing>;
  Deposit: ContainerType<phase0.Deposit>;
  ProposerSlashing: ContainerType<phase0.ProposerSlashing>;
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
  CommitteeAssignment: ContainerType<phase0.CommitteeAssignment>;
  AggregateAndProof: ContainerType<phase0.AggregateAndProof>;
  SignedAggregateAndProof: ContainerType<phase0.SignedAggregateAndProof>;
  // ReqResp
  Status: ContainerType<phase0.Status>;
  Goodbye: BigIntUintType;
  Ping: BigIntUintType;
  Metadata: ContainerType<phase0.Metadata>;
  BeaconBlocksByRangeRequest: ContainerType<phase0.BeaconBlocksByRangeRequest>;
  BeaconBlocksByRootRequest: ListType<List<phase0.BeaconBlocksByRootRequest>>;
  P2pErrorMessage: ListType<phase0.P2pErrorMessage>;
  //api
  AttesterDuty: ContainerType<phase0.AttesterDuty>;
  AttesterDutiesApi: ContainerType<phase0.AttesterDutiesApi>;
  BeaconCommitteeResponse: ContainerType<phase0.BeaconCommitteeResponse>;
  BeaconCommitteeSubscription: ContainerType<phase0.BeaconCommitteeSubscription>;
  BlockEventPayload: ContainerType<phase0.BlockEventPayload>;
  ChainHead: ContainerType<phase0.ChainHead>;
  ChainReorg: ContainerType<phase0.ChainReorg>;
  Contract: ContainerType<phase0.Contract>;
  FinalityCheckpoints: ContainerType<phase0.FinalityCheckpoints>;
  FinalizedCheckpoint: ContainerType<phase0.FinalizedCheckpoint>;
  Genesis: ContainerType<phase0.Genesis>;
  ProposerDuty: ContainerType<phase0.ProposerDuty>;
  ProposerDutiesApi: ContainerType<phase0.ProposerDutiesApi>;
  SignedBeaconHeaderResponse: ContainerType<phase0.SignedBeaconHeaderResponse>;
  SubscribeToCommitteeSubnetPayload: ContainerType<phase0.SubscribeToCommitteeSubnetPayload>;
  SyncingStatus: ContainerType<phase0.SyncingStatus>;
  ValidatorBalance: ContainerType<phase0.ValidatorBalance>;
  ValidatorResponse: ContainerType<phase0.ValidatorResponse>;
  // Non-speced types
  SlashingProtectionBlock: ContainerType<phase0.SlashingProtectionBlock>;
  SlashingProtectionAttestation: ContainerType<phase0.SlashingProtectionAttestation>;
  SlashingProtectionAttestationLowerBound: ContainerType<phase0.SlashingProtectionAttestationLowerBound>;
};
