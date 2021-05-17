import {altair} from "@chainsafe/lodestar-types";
import {getSyncCommittee} from "../state_accessor";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";

export function processSyncCommitteeUpdates(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess
): void {
  const {config} = state;
  const nextEpoch = process.currentEpoch + 1;
  if (nextEpoch % config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = getSyncCommittee(
      config,
      state,
      nextEpoch + config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
    );
  }
}
