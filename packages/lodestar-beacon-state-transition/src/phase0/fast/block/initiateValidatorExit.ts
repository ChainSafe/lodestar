import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";

import {FAR_FUTURE_EPOCH} from "../../../constants";
import {computeActivationExitEpoch, getChurnLimit} from "../../../util";
import {CachedBeaconState} from "../util";

/**
 * Initiate the exit of the validator with index ``index``.
 */
export function initiateValidatorExit(state: CachedBeaconState<phase0.BeaconState>, index: ValidatorIndex): void {
  const {config, validators, epochCtx} = state;
  // return if validator already initiated exit
  if (validators[index].exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  const currentEpoch = epochCtx.currentShuffling.epoch;

  // compute exit queue epoch
  const validatorExitEpochs = validators.map((v) => v.exitEpoch);
  const exitEpochs = validatorExitEpochs.filter((exitEpoch) => exitEpoch !== FAR_FUTURE_EPOCH);
  exitEpochs.push(computeActivationExitEpoch(config, currentEpoch));
  let exitQueueEpoch = Math.max(...exitEpochs);
  const exitQueueChurn = validatorExitEpochs.filter((exitEpoch) => exitEpoch === exitQueueEpoch).length;
  if (exitQueueChurn >= getChurnLimit(config, epochCtx.currentShuffling.activeIndices.length)) {
    exitQueueEpoch += 1;
  }

  // set validator exit epoch and withdrawable epoch
  validators.update(index, {
    exitEpoch: exitQueueEpoch,
    withdrawableEpoch: exitQueueEpoch + config.params.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
  });
}
