import {BeaconStateCachedAltair, IEpochProcess} from "../../types";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";

/**
 * Rotate nextSyncCommittee to currentSyncCommittee if sync committee period is over.
 *
 * PERF: Once every `EPOCHS_PER_SYNC_COMMITTEE_PERIOD`, do an expensive operation to compute the next committee.
 * Calculating the next sync committee has a proportional cost to $VALIDATOR_COUNT
 */
export function processSyncCommitteeUpdates(state: BeaconStateCachedAltair, epochProcess: IEpochProcess): void {
  const nextEpoch = epochProcess.currentEpoch + 1;
  if (nextEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.rotateSyncCommittee();
  }
}
