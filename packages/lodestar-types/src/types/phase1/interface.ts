import {NumberUintType, ContainerType} from "@chainsafe/ssz";
import * as types from "./types";

export interface IPhase1SSZTypes {
  //primitive
  Shard: NumberUintType;
  OnlineEpochs: NumberUintType;

  //updated containers
  AttestationData: ContainerType<types.AttestationData>;
  Attestation: ContainerType<types.Attestation>;
  PendingAttestation: ContainerType<types.PendingAttestation>;
  IndexedAttestation: ContainerType<types.IndexedAttestation>;
  AttesterSlashing: ContainerType<types.AttesterSlashing>;
  Validator: ContainerType<types.AttesterSlashing>;

  //shard
  ShardBlock: ContainerType<types.ShardBlock>;
  SignedShardBlock: ContainerType<types.SignedShardBlock>;
  ShardBlockHeader: ContainerType<types.ShardBlockHeader>;
  ShardState: ContainerType<types.ShardState>;
  ShardTransition: ContainerType<types.ShardTransition>;
  CompactCommittee: ContainerType<types.CompactCommittee>;

  //custody
  CustodyChunkChallenge: ContainerType<types.CustodyChunkChallenge>;
  CustodyChunkChallengeRecord: ContainerType<types.CustodyChunkChallengeRecord>;
  CustodyChunkResponse: ContainerType<types.CustodyChunkResponse>;
  CustodySlashing: ContainerType<types.CustodySlashing>;
  CustodyKeyReveal: ContainerType<types.CustodyKeyReveal>;
  SignedCustodySlashing: ContainerType<types.SignedCustodySlashing>;
  EarlyDerivedSecretReveal: ContainerType<types.EarlyDerivedSecretReveal>;

  //beacon
  BeaconBlockBody: ContainerType<types.BeaconBlockBody>;
  BeaconBlock: ContainerType<types.BeaconBlock>;
  SignedBeaconBlock: ContainerType<types.SignedBeaconBlock>;
  BeaconState: ContainerType<types.BeaconState>;
}
