import {BitVector, List, Vector} from "@chainsafe/ssz";

import * as phase0 from "../../phase0";
import {Shard, OnlineEpochs} from "./primitive";
import {PendingAttestation, Validator, Attestation, AttesterSlashing} from "./misc";
import {CompactCommittee, ShardState, ShardTransition} from "./shard";
import {
  CustodyChunkChallenge,
  CustodyChunkChallengeRecord,
  CustodyChunkResponse,
  CustodyKeyReveal,
  EarlyDerivedSecretReveal,
  SignedCustodySlashing,
} from "./custody";

export interface BeaconBlockBody extends phase0.BeaconBlockBody {
  attestations: List<Attestation>;
  attesterSlashings: List<AttesterSlashing>;
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
