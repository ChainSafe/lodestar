import {altair, phase0} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED,
  hasMarkers,
  IEpochProcess,
} from "../../allForks/util";
import {isInInactivityLeak} from "../../util";

export function processInactivityUpdates(state: CachedBeaconState<altair.BeaconState>, process: IEpochProcess): void {
  const {config} = state;
  const inActivityLeak = isInInactivityLeak((state as unknown) as phase0.BeaconState);
  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
        if (state.inactivityScores[i] > 0) {
          state.inactivityScores[i] -= 1;
        }
      } else if (inActivityLeak) {
        state.inactivityScores[i] += Number(config.INACTIVITY_SCORE_BIAS);
      }
    }
  }
}
