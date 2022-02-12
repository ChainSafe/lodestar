import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {Number64} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAltair, CachedBeaconStateAllForks, EpochProcess} from "../../types";
import * as attesterStatusUtil from "../../util/attesterStatus";
import {isInInactivityLeak} from "../../util";

/**
 * Mutates `inactivityScores` from pre-calculated validator statuses.
 *
 * PERF: Cost = iterate over an array of size $VALIDATOR_COUNT + 'proportional' to how many validtors are inactive or
 * have been inactive in the past, i.e. that require an update to their inactivityScore. Worst case = all validators
 * need to update their non-zero `inactivityScore`.
 *
 * - On normal mainnet conditions
 *   - prevTargetAttester: 96%
 *   - unslashed:          100%
 *   - eligibleAttester:   98%
 *
 * TODO: Compute from altair testnet inactivityScores updates on average
 */
export function processInactivityUpdates(state: CachedBeaconStateAltair, epochProcess: EpochProcess): void {
  if (state.currentShuffling.epoch === GENESIS_EPOCH) {
    return;
  }
  const {config, inactivityScores} = state;
  const {INACTIVITY_SCORE_BIAS, INACTIVITY_SCORE_RECOVERY_RATE} = config;
  const {statuses} = epochProcess;
  const inActivityLeak = isInInactivityLeak(state as CachedBeaconStateAllForks);

  // this avoids importing FLAG_ELIGIBLE_ATTESTER inside the for loop, check the compiled code
  const {FLAG_ELIGIBLE_ATTESTER, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED, hasMarkers} = attesterStatusUtil;
  const newValues = new Map<number, Number64>();
  inactivityScores.forEach(function processInactivityScore(inactivityScore, i) {
    const status = statuses[i];
    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
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
        newValues.set(i, inactivityScore);
      }
    }
  });
  inactivityScores.setMultiple(newValues);
}
