import {altair} from "@chainsafe/lodestar-types";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {getNextSyncCommittee} from "./sync_committee";

export function processSyncCommitteeUpdates(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess
): void {
  const {config} = state;
  const nextEpoch = process.currentEpoch + 1;
  if (nextEpoch % config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = getNextSyncCommittee(config, state);
  }
}
