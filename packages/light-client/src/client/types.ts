import {PublicKey} from "@chainsafe/bls";
import {altair, phase0, SyncPeriod} from "@chainsafe/lodestar-types";

export type LightClientStoreFast = {
  snapshot: LightClientSnapshotFast;
  bestUpdates: Map<SyncPeriod, altair.LightClientUpdate>;
};

export type LightClientSnapshotFast = {
  /** Beacon block header */
  header: phase0.BeaconBlockHeader;
  /** Sync committees corresponding to the header */
  currentSyncCommittee: SyncCommitteeFast;
  nextSyncCommittee: SyncCommitteeFast;
};

export type SyncCommitteeFast = {
  pubkeys: PublicKey[];
  aggregatePubkey: PublicKey;
};
