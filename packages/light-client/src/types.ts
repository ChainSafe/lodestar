import type {PublicKey} from "@chainsafe/bls/types";
import {LightClientHeader, LightClientUpdate, SyncPeriod} from "@lodestar/types";

export type LightClientStoreFast = {
  snapshot: LightClientSnapshotFast;
  bestUpdates: Map<SyncPeriod, LightClientUpdate>;
};

export type LightClientSnapshotFast = {
  /** Beacon block header */
  header: LightClientHeader;
  /** Sync committees corresponding to the header */
  currentSyncCommittee: SyncCommitteeFast;
  nextSyncCommittee: SyncCommitteeFast;
};

export type SyncCommitteeFast = {
  pubkeys: PublicKey[];
  aggregatePubkey: PublicKey;
};
