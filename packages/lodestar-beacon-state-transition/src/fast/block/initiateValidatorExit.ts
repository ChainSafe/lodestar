import {readOnlyMap} from "@chainsafe/ssz";
import {BeaconState, ValidatorIndex} from "@chainsafe/lodestar-types";

import {FAR_FUTURE_EPOCH} from "../../constants";
import {computeActivationExitEpoch, getChurnLimit} from "../../util";
import {EpochContext} from "../util";


export function initiateValidatorExit(
  epochCtx: EpochContext,
  state: BeaconState,
  index: ValidatorIndex
): void {
  const config = epochCtx.config;
  // return if validator already initiated exit
  const validator = state.validators[index];
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  const currentEpoch = epochCtx.currentShuffling.epoch;

  // compute exit queue epoch
  const validatorExitEpochs = readOnlyMap(state.validators, (v) => v.exitEpoch);
  const exitEpochs = validatorExitEpochs.filter((exitEpoch) => exitEpoch !== FAR_FUTURE_EPOCH);
  exitEpochs.push(computeActivationExitEpoch(config, currentEpoch));
  let exitQueueEpoch = Math.max(...exitEpochs);
  const exitQueueChurn = validatorExitEpochs.filter((exitEpoch) => exitEpoch === exitQueueEpoch).length;
  if (exitQueueChurn >= getChurnLimit(config, epochCtx.currentShuffling.activeIndices.length)) {
    exitQueueEpoch += 1;
  }

  // set validator exit epoch and withdrawable epoch
  validator.exitEpoch = exitQueueEpoch;
  validator.withdrawableEpoch = validator.exitEpoch + config.params.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
}
