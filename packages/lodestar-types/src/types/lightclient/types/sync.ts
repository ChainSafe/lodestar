import * as phase0 from "../..";
import {SyncCommittee, BeaconBlockHeader} from ".";
import {Vector, BitVector, List} from "@chainsafe/ssz";

export interface LightclientSnapshot {
  header: BeaconBlockHeader;
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}

export interface LightclientUpdate {
  header: BeaconBlockHeader;
  nextSyncCommittee: SyncCommittee;
  nextSyncCommitteeBranch: Vector<phase0.Bytes32>;
  finalityHeader: BeaconBlockHeader;
  finalityBranch: Vector<phase0.Bytes32>;
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: phase0.BLSSignature;
  forkVersion: phase0.Version;
}

export interface LightclientStore {
  snapshot: LightclientSnapshot;
  validUpdates: List<LightclientUpdate>;
}
