import {BitVector} from "@chainsafe/ssz";

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

export interface BeaconState extends phase0.BeaconState {
  // Sync committees
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}
