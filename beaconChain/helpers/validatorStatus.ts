import assert from "assert";

import {
	BeaconState,
	ValidatorIndex,
} from "../types";

import {
	GENESIS_EPOCH,
	INITIATED_EXIT,
	LATEST_SLASHED_EXIT_LENGTH,
	MIN_VALIDATOR_WITHDRAWAL_DELAY,
	WHISTLEBLOWER_REWARD_QUOTIENT,
} from "../constants";

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
    // TODO: Unsafe usage of toNumber for index
    const validator = state.validatorRegistry[index.toNumber()];
    validator.activationEpoch = isGenesis ? GENESIS_EPOCH : getEntryExitEffectEpoch(getCurrentEpoch(state));
}

/**
 * Initiate exit for the validator with the given index.
 * Note: that this function mutates state.
 * @param {BeaconState} state
 * @param {int} index
 */
export function initiateValidatorExit(state: BeaconState, index: ValidatorIndex): void {
    // TODO: Unsafe usage of toNumber for index
    const validator = state.validatorRegistry[index.toNumber()];
    validator.statusFlags = validator.statusFlags.or(INITIATED_EXIT);
}
/**
 * Exit the validator of the given ``index``.
 * Note that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
export function exitValidator(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index.toNumber()];

  // The following updates only occur if not previously exited
  const entryExitEffectEpoch = getEntryExitEffectEpoch(getCurrentEpoch(state));
  if (validator.exitEpoch.lte(entryExitEffectEpoch)) {
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
  const validator = state.validatorRegistry[index.toNumber()];
  const currentEpoch = getCurrentEpoch(state)
  // Remove assertion in phase 2
  assert(state.slot.lt(getEpochStartSlot(validator.withdrawalEpoch)));

  exitValidator(state, index);
  state.latestSlashedBalances[currentEpoch.modn(LATEST_SLASHED_EXIT_LENGTH)] =
    state.latestSlashedBalances[currentEpoch.modn(LATEST_SLASHED_EXIT_LENGTH)].addn(getEffectiveBalance(state, index));

  const whistleblowerIndex = getBeaconProposerIndex(state, state.slot);
  const whistleblowerReward = Math.floor(getEffectiveBalance(state, index) / WHISTLEBLOWER_REWARD_QUOTIENT);
  state.validatorBalances[whistleblowerIndex] = 
    state.validatorBalances[whistleblowerIndex].addn(whistleblowerReward);
  state.validatorBalances[index.toNumber()] = 
    state.validatorBalances[index.toNumber()].subn(whistleblowerReward);

  validator.slashedEpoch = currentEpoch
  validator.withdrawalEpoch = currentEpoch.addn(LATEST_SLASHED_EXIT_LENGTH);
}

/**
 * Set the validator with the given ``index`` as withdrawable
 * ``MIN_VALIDATOR_WITHDRAWAL_DELAY`` after the current epoch.
 * Note that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
function prepareValidatorForWithdrawal(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index.toNumber()];
  validator.withdrawalEpoch = getCurrentEpoch(state).addn(MIN_VALIDATOR_WITHDRAWAL_DELAY)
}
