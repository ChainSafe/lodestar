import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";
import {altair} from "@chainsafe/lodestar-types";
import {getNextSyncCommittee} from "../../../altair/state_accessor";
import {getCurrentEpoch} from "../../../util";

/**
 * Call to ``proces_sync_committee_updates`` added to ``process_epoch`` in HF1
 */
export function processSyncCommitteeUpdates(state: altair.BeaconState): void {
  const nextEpoch = getCurrentEpoch(state) + 1;
  if (nextEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = getNextSyncCommittee(state);
  }
}
