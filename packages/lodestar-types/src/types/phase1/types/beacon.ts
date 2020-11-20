import * as phase0 from "../..";
import {
  Shard,
  CustodyChunkChallenge,
  CustodyChunkResponse,
  CustodyKeyReveal,
  EarlyDerivedSecretReveal,
  SignedCustodySlashing,
  ShardTransition,
  ShardState,
  OnlineEpochs,
  CompactCommittee,
  CustodyChunkChallengeRecord,
} from ".";
import {List, Vector, BitVector} from "@chainsafe/ssz";

export interface AttestationData extends phase0.AttestationData {
  // Shard vote
  shard: Shard;
  // Current-slot shard block root
  shardHeadRoot: phase0.Root;
  // Shard transition root
  shardTransitionRoot: phase0.Root;
}

export interface Attestation extends phase0.Attestation {
  data: AttestationData;
}

export interface IndexedAttestation extends phase0.IndexedAttestation {
  data: AttestationData;
}

export interface PendingAttestation extends phase0.PendingAttestation {
  data: AttestationData;
  crosslinkSuccess: boolean;
}
export interface AttesterSlashing extends phase0.AttesterSlashing {
  attestation1: IndexedAttestation;
  attestation2: IndexedAttestation;
}

export interface Validator extends phase0.Validator {
  nextCustodySecretToReveal: phase0.Uint64;
  allCustodySecretsRevealedEpoch: phase0.Epoch;
}

export interface BeaconBlockBody extends phase0.BeaconBlockBody {
  // Custody game
  chunkChallenges: List<CustodyChunkChallenge>;
  chunkChallengeResponses: List<CustodyChunkResponse>;
  custodyKeyReveals: List<CustodyKeyReveal>;
  earlyDerivedSecretReveals: List<EarlyDerivedSecretReveal>;
  custodySlashings: List<SignedCustodySlashing>;
  // Shards
  shardTransitions: Vector<ShardTransition>;
  // Light clients
  lightClientBits: BitVector;
  lightClientSignature: phase0.BLSSignature;
}

export interface BeaconBlock extends phase0.BeaconBlock {
  body: BeaconBlockBody;
}

export interface SignedBeaconBlock extends phase0.SignedBeaconBlock {
  message: BeaconBlock;
}

export interface BeaconState extends phase0.BeaconState {
  validators: List<Validator>;
  previousEpochAttestations: List<PendingAttestation>;
  currentEpochAttestations: List<PendingAttestation>;
  // Phase 1
  currentEpochStartShard: Shard;
  shardStates: List<ShardState>;
  onlineCountdown: List<OnlineEpochs>; // not a raw byte array, considered its large size.
  currentLightCommittee: CompactCommittee;
  nextLightCommittee: CompactCommittee;
  // Custody game
  // Future derived secrets already exposed; contains the indices of the exposed validator
  // at RANDAO reveal period % EARLY_DERIVED_SECRET_PENALTY_MAX_FUTURE_EPOCHS
  exposedDerivedSecrets: Vector<List<phase0.ValidatorIndex>>;
  custodyChunkChallengeRecords: List<CustodyChunkChallengeRecord>;
  custodyChunkChallengeIndex: phase0.Uint64;
}
