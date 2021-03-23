import {NumberUintType, ContainerType} from "@chainsafe/ssz";

import {ILightclientSSZTypes} from "../../lightclient";
import * as phase1 from "../types";

export type IPhase1SSZTypes = Omit<
  ILightclientSSZTypes,
  | "AttestationData"
  | "Attestation"
  | "PendingAttestation"
  | "IndexedAttestation"
  | "AttesterSlashing"
  | "Validator"
  | "BeaconBlockBody"
  | "BeaconBlock"
  | "SignedBeaconBlock"
  | "BeaconState"
> & {
  //primitive
  Shard: NumberUintType;
  OnlineEpochs: NumberUintType;

  //updated containers
  AttestationData: ContainerType<phase1.AttestationData>;
  Attestation: ContainerType<phase1.Attestation>;
  PendingAttestation: ContainerType<phase1.PendingAttestation>;
  IndexedAttestation: ContainerType<phase1.IndexedAttestation>;
  AttesterSlashing: ContainerType<phase1.AttesterSlashing>;
  Validator: ContainerType<phase1.Validator>;

  //shard
  ShardBlock: ContainerType<phase1.ShardBlock>;
  SignedShardBlock: ContainerType<phase1.SignedShardBlock>;
  ShardBlockHeader: ContainerType<phase1.ShardBlockHeader>;
  ShardState: ContainerType<phase1.ShardState>;
  ShardTransition: ContainerType<phase1.ShardTransition>;
  CompactCommittee: ContainerType<phase1.CompactCommittee>;

  //custody
  CustodyChunkChallenge: ContainerType<phase1.CustodyChunkChallenge>;
  CustodyChunkChallengeRecord: ContainerType<phase1.CustodyChunkChallengeRecord>;
  CustodyChunkResponse: ContainerType<phase1.CustodyChunkResponse>;
  CustodySlashing: ContainerType<phase1.CustodySlashing>;
  CustodyKeyReveal: ContainerType<phase1.CustodyKeyReveal>;
  SignedCustodySlashing: ContainerType<phase1.SignedCustodySlashing>;
  EarlyDerivedSecretReveal: ContainerType<phase1.EarlyDerivedSecretReveal>;

  //beacon
  BeaconBlockBody: ContainerType<phase1.BeaconBlockBody>;
  BeaconBlock: ContainerType<phase1.BeaconBlock>;
  SignedBeaconBlock: ContainerType<phase1.SignedBeaconBlock>;
  BeaconState: ContainerType<phase1.BeaconState>;
};
