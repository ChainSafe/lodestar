import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
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
  if (state.currentShuffling.epoch === GENESIS_EPOCH) {
    return;
  }
  const {config} = state;
  const {INACTIVITY_SCORE_BIAS, INACTIVITY_SCORE_RECOVERY_RATE} = config;
  const inActivityLeak = isInInactivityLeak((state as unknown) as phase0.BeaconState);
  const {inactivityScores} = state;
  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      let inactivityScore = inactivityScores[i];
      const prevInactivityScore = inactivityScore;
      if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
        inactivityScore -= Math.min(1, inactivityScore);
      } else {
        inactivityScore += Number(INACTIVITY_SCORE_BIAS);
      }
      if (!inActivityLeak) {
        inactivityScore -= Math.min(Number(INACTIVITY_SCORE_RECOVERY_RATE), inactivityScore);
      }
      if (inactivityScore !== prevInactivityScore) {
        inactivityScores[i] = inactivityScore;
      }
    }
  }
}
