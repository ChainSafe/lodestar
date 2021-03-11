import {BitVector, List} from "@chainsafe/ssz";
import {ValidatorFlag} from "../..";
import * as phase0 from "../../phase0";
import {SyncCommittee} from "./committee";

export interface BeaconBlockBody extends phase0.BeaconBlockBody {
  // Sync committee aggregate signature
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: phase0.BLSSignature;
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
  previousEpochParticipation: List<ValidatorFlag>;
  currentEpochParticipation: List<ValidatorFlag>;
  // Sync committees
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}
