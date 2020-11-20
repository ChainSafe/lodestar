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

  //
  ShardBlock: ContainerType<types.ShardBlock>;
  SignedShardBlock: ContainerType<types.SignedShardBlock>;
  ShardBlockHeader: ContainerType<types.ShardBlockHeader>;
  ShardState: ContainerType<types.ShardState>;
  ShardTransition: ContainerType<types.ShardTransition>;
  CompactCommittee: ContainerType<types.CompactCommittee>;
}
