/**
 * @module chain/stateTransition/util
 */

import {
  BeaconState,
  Epoch,
  Validator,
  ValidatorIndex,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {FAR_FUTURE_EPOCH} from "../../../constants";
import {computeActivationExitEpoch, getCurrentEpoch} from "./epoch";
import {getValidatorChurnLimit} from "./validator";
import {decreaseBalance, increaseBalance} from "./balance";
import {getBeaconProposerIndex} from "./proposer";
import {bnMax} from "../../../util/math";


/**
 * Initiate exit for the validator with the given index.
 *
 * Note: that this function mutates state.
 */
export function initiateValidatorExit(config: IBeaconConfig, state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validators[index];

  // Return if validator already initiated exit
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  // Compute exit queue epoch
  let exitQueueEpoch = state.validators.reduce((epoch: Epoch, v: Validator) => {
    if (v.exitEpoch !== FAR_FUTURE_EPOCH) {
      return Math.max(v.exitEpoch, epoch);
    }
    return epoch;
  }, computeActivationExitEpoch(config, getCurrentEpoch(config, state)));
  const exitQueueChurn = state.validators
    .filter((v: Validator) => v.exitEpoch === exitQueueEpoch).length;
  if (exitQueueChurn >= getValidatorChurnLimit(config, state)) {
    exitQueueEpoch += 1;
  }

  // Set validator exit epoch and withdrawable epoch
  validator.exitEpoch = exitQueueEpoch;
  validator.withdrawableEpoch = validator.exitEpoch + config.params.MIN_VALIDATOR_WITHDRAWAL_DELAY;
}

/**
 * Slash the validator with index ``slashedIndex``.
 *
 * Note that this function mutates ``state``.
 */
export function slashValidator(
  config: IBeaconConfig,
  state: BeaconState,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex: ValidatorIndex | null = null
): void {
  const currentEpoch = getCurrentEpoch(config, state);

  initiateValidatorExit(config, state, slashedIndex);
  state.validators[slashedIndex].slashed = true;
  state.validators[slashedIndex].withdrawableEpoch = Math.max(
    state.validators[slashedIndex].withdrawableEpoch,
    currentEpoch + config.params.EPOCHS_PER_SLASHINGS_VECTOR
  );

  const slashedBalance = state.validators[slashedIndex].effectiveBalance;
  state.slashings[currentEpoch % config.params.EPOCHS_PER_SLASHINGS_VECTOR] =
    state.slashings[currentEpoch % config.params.EPOCHS_PER_SLASHINGS_VECTOR].add(slashedBalance);
  decreaseBalance(
    state,
    slashedIndex,
    state.validators[slashedIndex].effectiveBalance.divn(config.params.MIN_SLASHING_PENALTY_QUOTIENT));


  const proposerIndex = getBeaconProposerIndex(config, state);
  if (whistleblowerIndex === undefined || whistleblowerIndex === null) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowingReward = slashedBalance.divn(config.params.WHISTLEBLOWING_REWARD_QUOTIENT);
  const proposerReward = whistleblowingReward.divn(config.params.PROPOSER_REWARD_QUOTIENT);
  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowingReward.sub(proposerReward));
}
