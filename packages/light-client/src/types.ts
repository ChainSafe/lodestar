import type {PublicKey} from "@chainsafe/bls/types";
import {altair, phase0, SyncPeriod} from "@lodestar/types";

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

export type LightClientStore = {
  // Header that is finalized
  finalizedHeader: phase0.BeaconBlockHeader;
  // Sync committees corresponding to the finalized header
  currentSyncCommittee: SyncCommitteeFast;
  nextSyncCommittee: SyncCommitteeFast | null;
  // Best available header to switch finalized head to if we see nothing else
  bestValidUpdate: altair.LightClientUpdate | null;
  // Most recent available reasonably-safe header
  optimisticHeader: phase0.BeaconBlockHeader;
  // Max number of active participants in a sync committee (used to calculate safety threshold)
  previousMaxActiveParticipants: number;
  currentMaxActiveParticipants: number;
};
