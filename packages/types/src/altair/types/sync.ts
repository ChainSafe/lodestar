import {Vector, BitVector, List} from "@chainsafe/ssz";

import * as primitive from "../../primitive/types";
import * as phase0 from "../../phase0/types";
import {SyncCommittee} from "./committee";

export interface AltairSnapshot {
  header: phase0.BeaconBlockHeader;
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}

export interface AltairUpdate {
  header: phase0.BeaconBlockHeader;
  nextSyncCommittee: SyncCommittee;
  nextSyncCommitteeBranch: Vector<primitive.Bytes32>;
  finalityHeader: phase0.BeaconBlockHeader;
  finalityBranch: Vector<primitive.Bytes32>;
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: primitive.BLSSignature;
  forkVersion: primitive.Version;
}

export interface AltairStore {
  snapshot: AltairSnapshot;
  validUpdates: List<AltairUpdate>;
}
