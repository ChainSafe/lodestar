/**
 * @module chain/stateTransition/util
 */

import {
  BeaconState,
  Epoch,
  ValidatorIndex,
  Validator,
} from "../../../types";

import {
  LATEST_SLASHED_EXIT_LENGTH,
  MIN_VALIDATOR_WITHDRAWAL_DELAY,
  FAR_FUTURE_EPOCH,
  WHISTLEBLOWING_REWARD_QUOTIENT,
  PROPOSER_REWARD_QUOTIENT,
} from "../../../constants";

import {
  getCurrentEpoch,
  getDelayedActivationExitEpoch,
} from "./epoch";

import {
  increaseBalance,
  decreaseBalance,
} from "./balance";

import {
  getBeaconProposerIndex,
  getChurnLimit,
} from "./misc";


/**
 * Initiate exit for the validator with the given index.
 *
 * Note: that this function mutates state.
 */
export function initiateValidatorExit(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index];

  // Return if validator already initiated exit
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  // Compute exit queue epoch
  let exitQueueEpoch = state.validatorRegistry.reduce((epoch: Epoch, v: Validator) => {
    if (v.exitEpoch !== FAR_FUTURE_EPOCH) {
      return Math.max(v.exitEpoch, epoch);
    }
    return epoch;
  }, getDelayedActivationExitEpoch(getCurrentEpoch(state)));
  const exitQueueChurn = state.validatorRegistry
    .filter((v: Validator) => v.exitEpoch === exitQueueEpoch).length;
  if (exitQueueChurn >= getChurnLimit(state)) {
    exitQueueEpoch += 2;
  }

  // Set validator exit epoch and withdrawable epoch
  validator.exitEpoch = exitQueueEpoch;
  validator.withdrawableEpoch = validator.exitEpoch + MIN_VALIDATOR_WITHDRAWAL_DELAY;
}

/**
 * Slash the validator with index ``slashedIndex``.
 *
 * Note that this function mutates ``state``.
 */
export function slashValidator(
  state: BeaconState,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex: ValidatorIndex | null = null
): void {
  const currentEpoch = getCurrentEpoch(state);

  initiateValidatorExit(state, slashedIndex);
  state.validatorRegistry[slashedIndex].slashed = true;
  state.validatorRegistry[slashedIndex].withdrawableEpoch =
    currentEpoch + LATEST_SLASHED_EXIT_LENGTH;
  const slashedBalance = state.validatorRegistry[slashedIndex].effectiveBalance;
  state.latestSlashedBalances[currentEpoch % LATEST_SLASHED_EXIT_LENGTH] =
    state.latestSlashedBalances[currentEpoch % LATEST_SLASHED_EXIT_LENGTH].add(slashedBalance);

  const proposerIndex = getBeaconProposerIndex(state);
  if (whistleblowerIndex === undefined || whistleblowerIndex === null) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowingReward = slashedBalance.divn(WHISTLEBLOWING_REWARD_QUOTIENT);
  const proposerReward = whistleblowingReward.divn(PROPOSER_REWARD_QUOTIENT);
  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowingReward.sub(proposerReward));
  decreaseBalance(state, slashedIndex, whistleblowingReward);
}
