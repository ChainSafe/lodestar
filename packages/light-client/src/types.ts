import type {PublicKey} from "@chainsafe/bls/types";
import {SyncPeriod, allForks} from "@lodestar/types";

export type LightClientStoreFast = {
  snapshot: LightClientSnapshotFast;
  bestUpdates: Map<SyncPeriod, allForks.LightClientUpdate>;
};

export type LightClientSnapshotFast = {
  /** Beacon block header */
  header: allForks.LightClientHeader;
  /** Sync committees corresponding to the header */
  currentSyncCommittee: SyncCommitteeFast;
  nextSyncCommittee: SyncCommitteeFast;
};

export type SyncCommitteeFast = {
  pubkeys: PublicKey[];
  aggregatePubkey: PublicKey;
};
