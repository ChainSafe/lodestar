import {GENESIS_EPOCH} from "@lodestar/params";
import {CachedBeaconStateAltair, EpochTransitionCache} from "../types.js";
import * as attesterStatusUtil from "../util/attesterStatus.js";
import {isInInactivityLeak} from "../util/index.js";

/**
 * This data is reused and never gc.
 */
const inactivityScoresArr = new Array<number>();

/**
 * Mutates `inactivityScores` from pre-calculated validator flags.
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
export function processInactivityUpdates(state: CachedBeaconStateAltair, cache: EpochTransitionCache): void {
  if (state.epochCtx.epoch === GENESIS_EPOCH) {
    return;
  }

  const {config, inactivityScores} = state;
  const {INACTIVITY_SCORE_BIAS, INACTIVITY_SCORE_RECOVERY_RATE} = config;
  const {flags} = cache;
  const inActivityLeak = isInInactivityLeak(state);

  // this avoids importing FLAG_ELIGIBLE_ATTESTER inside the for loop, check the compiled code
  const {FLAG_PREV_TARGET_ATTESTER_UNSLASHED, FLAG_ELIGIBLE_ATTESTER, hasMarkers} = attesterStatusUtil;

  inactivityScoresArr.length = state.validators.length;
  inactivityScores.getAll(inactivityScoresArr);

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) {
      let inactivityScore = inactivityScoresArr[i];

      const prevInactivityScore = inactivityScore;
      if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
        inactivityScore -= Math.min(1, inactivityScore);
      } else {
        inactivityScore += INACTIVITY_SCORE_BIAS;
      }
      if (!inActivityLeak) {
        inactivityScore -= Math.min(INACTIVITY_SCORE_RECOVERY_RATE, inactivityScore);
      }
      if (inactivityScore !== prevInactivityScore) {
        inactivityScores.set(i, inactivityScore);
      }
    }
  }
}
