import {ValidatorIndex} from "@chainsafe/lodestar-types";

import {FAR_FUTURE_EPOCH} from "../../constants";
import {computeActivationExitEpoch, getChurnLimit} from "../../util";
import {CachedBeaconState} from "../util/cachedBeaconState";

/**
 * Initiate the exit of the validator with index ``index``.
 */
export function initiateValidatorExit(cachedState: CachedBeaconState, index: ValidatorIndex): void {
  const config = cachedState.config;
  // return if validator already initiated exit
  if (cachedState.validators[index].exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  const currentEpoch = cachedState.currentShuffling.epoch;

  // compute exit queue epoch
  const validatorExitEpochs = cachedState.flatValidators().readOnlyMap((v) => v.exitEpoch);
  const exitEpochs = validatorExitEpochs.filter((exitEpoch) => exitEpoch !== FAR_FUTURE_EPOCH);
  exitEpochs.push(computeActivationExitEpoch(config, currentEpoch));
  let exitQueueEpoch = Math.max(...exitEpochs);
  const exitQueueChurn = validatorExitEpochs.filter((exitEpoch) => exitEpoch === exitQueueEpoch).length;
  if (exitQueueChurn >= getChurnLimit(config, cachedState.currentShuffling.activeIndices.length)) {
    exitQueueEpoch += 1;
  }

  // set validator exit epoch and withdrawable epoch
  cachedState.updateValidator(index, {
    exitEpoch: exitQueueEpoch,
    withdrawableEpoch: exitQueueEpoch + config.params.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
  });
}
