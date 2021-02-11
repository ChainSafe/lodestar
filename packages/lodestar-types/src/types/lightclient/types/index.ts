import * as phase0 from "../..";
import {BitVector, Vector, List} from "@chainsafe/ssz";
import {ValidatorFlag} from "../..";

export * from "./sync";

export interface SyncCommittee {
  pubkeys: Vector<phase0.BLSPubkey>;
  pubkeyAggregates: Vector<phase0.BLSPubkey>;
}

export interface BeaconBlock extends phase0.BeaconBlock {
  // Sync committee aggregate signature
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: phase0.BLSSignature;
}

export interface SignedBeaconBlock extends phase0.SignedBeaconBlock {
  message: BeaconBlock;
}

export interface BeaconBlockHeader extends phase0.BeaconBlockHeader {
  // Sync committee aggregate signature
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: phase0.BLSSignature;
}

export interface BeaconState extends phase0.BeaconState {
  // Participation
  previousEpochParticipation: List<ValidatorFlag>;
  currentEpochParticipation: List<ValidatorFlag>;
  // Sync committees
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}
