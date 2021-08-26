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
export function processInactivityUpdates(
  state: CachedBeaconState<altair.BeaconState>,
  epochProcess: IEpochProcess
): void {
  if (state.currentShuffling.epoch === GENESIS_EPOCH) {
    return;
  }
  const {config, inactivityScores} = state;
  const {INACTIVITY_SCORE_BIAS, INACTIVITY_SCORE_RECOVERY_RATE} = config;
  const {statusesFlat} = epochProcess;
  const inActivityLeak = isInInactivityLeak((state as unknown) as phase0.BeaconState);

  for (let i = 0; i < statusesFlat.length; i++) {
    const status = statusesFlat[i];
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
