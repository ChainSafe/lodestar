import {BitVector, List} from "@chainsafe/ssz";
import {Number64, ParticipationFlags} from "../../primitive/types";
import * as phase0 from "../../phase0/types";
import {SyncCommittee} from "./committee";

export interface SyncAggregate {
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: phase0.BLSSignature;
}

export interface BeaconBlockBody extends phase0.BeaconBlockBody {
  syncAggregate: SyncAggregate;
}

export interface BeaconBlock extends phase0.BeaconBlock {
  body: BeaconBlockBody;
}

export interface SignedBeaconBlock extends phase0.SignedBeaconBlock {
  message: BeaconBlock;
}

export interface BeaconState
  extends Omit<phase0.BeaconState, "previousEpochAttestations" | "currentEpochAttestations"> {
  // Participation
  previousEpochParticipation: List<ParticipationFlags>;
  currentEpochParticipation: List<ParticipationFlags>;
  // Inactivity
  inactivityScores: List<Number64>;
  // Sync
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}
