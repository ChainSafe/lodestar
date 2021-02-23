import * as phase0 from "../../phase0";
import {Shard} from "./primitive";

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
