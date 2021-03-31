import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch} from "@chainsafe/lodestar-types";
import {allForks} from "@chainsafe/lodestar-types";
import {getActiveValidatorIndices, getCurrentEpoch} from ".";

/**
 * Returns the epoch of the latest weak subjectivity checkpoint for the given
  `state` and `safetyDecay`. The default `safetyDecay` used should be 10% (= 0.1)
 */
export function getLatestWeakSubjectivityCheckpointEpoch(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  safetyDecay = 0.1
): Epoch {
  let weakSubjectivityMod = config.params.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
  const valCount = getActiveValidatorIndices(state, getCurrentEpoch(config, state)).length;

  if (valCount >= config.params.MIN_PER_EPOCH_CHURN_LIMIT * config.params.CHURN_LIMIT_QUOTIENT) {
    weakSubjectivityMod += 256 * Math.floor((safetyDecay * config.params.CHURN_LIMIT_QUOTIENT) / 2 / 256);
  } else {
    weakSubjectivityMod +=
      256 * Math.floor((safetyDecay * valCount) / (2 * config.params.MIN_PER_EPOCH_CHURN_LIMIT) / 256);
  }
  return state.finalizedCheckpoint.epoch - (state.finalizedCheckpoint.epoch % weakSubjectivityMod);
}
