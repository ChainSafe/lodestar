import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAltair, EpochProcess} from "../../types.js";
import * as attesterStatusUtil from "../../util/attesterStatus.js";
import {isInInactivityLeak} from "../../util/index.js";

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
  if (state.epochCtx.epoch === GENESIS_EPOCH) {
    return;
  }

  const {config, inactivityScores} = state;
  const {INACTIVITY_SCORE_BIAS, INACTIVITY_SCORE_RECOVERY_RATE} = config;
  const {statuses, eligibleValidatorIndices} = epochProcess;
  const inActivityLeak = isInInactivityLeak(state);

  // this avoids importing FLAG_ELIGIBLE_ATTESTER inside the for loop, check the compiled code
  const {FLAG_PREV_TARGET_ATTESTER_UNSLASHED, hasMarkers} = attesterStatusUtil;

  const inactivityScoresArr = inactivityScores.getAll();

  for (let j = 0; j < eligibleValidatorIndices.length; j++) {
    const i = eligibleValidatorIndices[j];
    const status = statuses[i];
    let inactivityScore = inactivityScoresArr[i];

    const prevInactivityScore = inactivityScore;
    if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
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
