import * as phase0 from "../..";
import {ShardTransition, Attestation} from ".";
import {ByteVector, Vector, List} from "@chainsafe/ssz";

export interface CustodyChunkChallenge {
  responderIndex: phase0.ValidatorIndex;
  shardTransition: ShardTransition;
  attestation: Attestation;
  dataIndex: phase0.Uint64;
  chunkIndex: phase0.Uint64;
}

export interface CustodyChunkChallengeRecord {
  challengeIndex: phase0.Uint64;
  challengerIndex: phase0.ValidatorIndex;
  responderIndex: phase0.ValidatorIndex;
  inclusionEpoch: phase0.Epoch;
  dataRoot: phase0.Root;
  chunkIndex: phase0.Uint64;
}

export interface CustodyChunkResponse {
  challenge_index: phase0.Uint64;
  chunk_index: phase0.Uint64;
  chunk: ByteVector;
  branch: Vector<phase0.Root>;
}

export interface CustodySlashing {
  // (Attestation.data.shard_transition_root as ShardTransition).shard_data_roots[data_index] is the root of the data.
  dataIndex: phase0.Uint64;
  malefactorIndex: phase0.ValidatorIndex;
  malefactorSecret: phase0.BLSSignature;
  whistleblowerIndex: phase0.ValidatorIndex;
  shardTransition: ShardTransition;
  attestation: Attestation;
  data: List<phase0.Uint8>;
}

export interface SignedCustodySlashing {
  message: CustodySlashing;
  signature: phase0.BLSSignature;
}

export interface CustodyKeyReveal {
  // Index of the validator whose key is being revealed
  revealer_index: phase0.ValidatorIndex;
  // Reveal (masked signature)
  reveal: phase0.BLSSignature;
}

export interface EarlyDerivedSecretReveal {
  // Index of the validator whose key is being revealed
  revealed_index: phase0.ValidatorIndex;
  // RANDAO epoch of the key that is being revealed
  epoch: phase0.Epoch;
  // Reveal (masked signature)
  reveal: phase0.BLSSignature;
  // Index of the validator who revealed (whistleblower)
  masker_index: phase0.ValidatorIndex;
  // Mask used to hide the actual reveal signature (prevent reveal from being stolen)
  mask: phase0.Bytes32;
}
