import {altair} from "@chainsafe/lodestar-types";
import {getSyncCommittee} from "../state_accessor";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";

export function processSyncCommitteeUpdates(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess
): void {
  const nextEpoch = process.currentEpoch + 1;
  if (nextEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = getSyncCommittee(state, nextEpoch + EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  }
}
