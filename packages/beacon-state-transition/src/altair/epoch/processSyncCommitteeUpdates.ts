import {altair} from "@chainsafe/lodestar-types";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@chainsafe/lodestar-params";

export function processSyncCommitteeUpdates(
  state: CachedBeaconState<altair.BeaconState>,
  epochProcess: IEpochProcess
): void {
  const nextEpoch = epochProcess.currentEpoch + 1;
  if (nextEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.rotateSyncCommittee();
  }
}
