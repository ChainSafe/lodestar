import assert from "assert";

import {
  BeaconState,
  ValidatorIndex,
} from "../../types";

import {
  GENESIS_EPOCH,
  INITIATED_EXIT,
  LATEST_SLASHED_EXIT_LENGTH,
  MIN_VALIDATOR_WITHDRAWAL_DELAY,
  WHISTLEBLOWER_REWARD_QUOTIENT,
} from "../../constants";

import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getEffectiveBalance,
  getEntryExitEffectEpoch,
  getEpochStartSlot,
} from "./stateTransitionHelpers";

/**
 * Activate a validator given an index.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 * @param {boolean} isGenesis
 */
export function activateValidator(state: BeaconState, index: ValidatorIndex, isGenesis: boolean): void {
  const validator = state.validatorRegistry[index];
  validator.activationEpoch = isGenesis ? GENESIS_EPOCH : getEntryExitEffectEpoch(getCurrentEpoch(state));
}

/**
 * Initiate exit for the validator with the given index.
 * Note: that this function mutates state.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
export function initiateValidatorExit(state: BeaconState, index: ValidatorIndex): void {
  // TODO: Unsafe usage of toNumber for index
  const validator = state.validatorRegistry[index];
  validator.statusFlags = validator.statusFlags.or(INITIATED_EXIT);
}
/**
 * Exit the validator of the given ``index``.
 * Note that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
export function exitValidator(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index];

  // The following updates only occur if not previously exited
  const entryExitEffectEpoch = getEntryExitEffectEpoch(getCurrentEpoch(state));
  if (validator.exitEpoch <= entryExitEffectEpoch) {
    return;
  }

  validator.exitEpoch = entryExitEffectEpoch;
}

/**
 * Slash the validator with index ``index``.
 * Note that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
export function slashValidator(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index];
  const currentEpoch = getCurrentEpoch(state);
  // Remove assertion in phase 2
  assert(state.slot < getEpochStartSlot(validator.withdrawalEpoch));

  exitValidator(state, index);
  state.latestSlashedBalances[currentEpoch % LATEST_SLASHED_EXIT_LENGTH] =
    state.latestSlashedBalances[currentEpoch % LATEST_SLASHED_EXIT_LENGTH].add(getEffectiveBalance(state, index));

  const whistleblowerIndex = getBeaconProposerIndex(state, state.slot);
  const whistleblowerReward = getEffectiveBalance(state, index).divn(WHISTLEBLOWER_REWARD_QUOTIENT);
  state.validatorBalances[whistleblowerIndex] =
    state.validatorBalances[whistleblowerIndex].add(whistleblowerReward);
  state.validatorBalances[index] =
    state.validatorBalances[index].sub(whistleblowerReward);

  validator.slashedEpoch = currentEpoch;
  validator.withdrawalEpoch = currentEpoch + LATEST_SLASHED_EXIT_LENGTH;
}

/**
 * Set the validator with the given ``index`` as withdrawable
 * ``MIN_VALIDATOR_WITHDRAWAL_DELAY`` after the current epoch.
 * Note that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
export function prepareValidatorForWithdrawal(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index];
  validator.withdrawalEpoch = getCurrentEpoch(state) + MIN_VALIDATOR_WITHDRAWAL_DELAY;
}
