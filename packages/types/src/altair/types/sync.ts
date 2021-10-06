import {Vector, BitVector, List} from "@chainsafe/ssz";

import * as primitive from "../../primitive/types";
import * as phase0 from "../../phase0/types";
import {SyncCommittee} from "./committee";

/**
 * Spec v1.0.1
 */
export interface LightClientSnapshot {
  /** Beacon block header */
  header: phase0.BeaconBlockHeader;
  /** Sync committees corresponding to the header */
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}

/**
 * Spec v1.0.1
 */
export interface LightClientUpdate {
  /** Update beacon block header */
  header: phase0.BeaconBlockHeader;
  /** Next sync committee corresponding to the header */
  nextSyncCommittee: SyncCommittee;
  nextSyncCommitteeBranch: Vector<primitive.Bytes32>;
  /** Finality proof for the update header */
  finalityHeader: phase0.BeaconBlockHeader;
  finalityBranch: Vector<primitive.Bytes32>;
  /** Sync committee aggregate signature */
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: primitive.BLSSignature;
  /** Fork version for the aggregate signature */
  forkVersion: primitive.Version;
}
export interface LightClientUpdateLatest {
  /** Update beacon block header */
  header: phase0.BeaconBlockHeader;
  /** Next sync committee corresponding to the header */
  nextSyncCommittee: SyncCommittee;
  nextSyncCommitteeBranch: Vector<primitive.Bytes32>;
  /** Finality proof for the update header */
  finalityHeader: phase0.BeaconBlockHeader;
  finalityBranch: Vector<primitive.Bytes32>;
  /** Execution block hash for the update header */
  latestExecutionBlockHash: primitive.Bytes32;
  latestExecutionBlockHashBranch: Vector<primitive.Bytes32>;
  /** Sync committee aggregate signature */
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: primitive.BLSSignature;
  /** Fork version for the aggregate signature */
  forkVersion: primitive.Version;
}

/**
 * Spec v1.0.1
 */
export interface LightClientStore {
  snapshot: LightClientSnapshot;
  validUpdates: List<LightClientUpdate>;
}
