import {
  getActiveValidatorIndices, getCurrentEpoch, getCurrentEpochCommitteeCount,
  getEffectiveBalance, getEntryExitEffectEpoch, getTotalBalance
} from "../../../helpers/stateTransitionHelpers";
import {BeaconState, Shard} from "../../../types";
import {
  EJECTION_BALANCE, INITIATED_EXIT, MAX_BALANCE_CHURN_QUOTIENT, MAX_DEPOSIT_AMOUNT,
  SHARD_COUNT
} from "../../../constants";
import BN from "bn.js";
import {activateValidator} from "../../state";

/**
 * Check if the latest crosslink epochs are valid for all shards.
 * @param {BeaconState} state
 * @returns {boolean}
 */
export function isValidCrosslink(state: BeaconState): boolean {
  let shards: Shard[] = [];
  for (let i: number = 0; i < getCurrentEpochCommitteeCount(state); i++) {
    const shard: BN = state.currentShufflingStartShard.addn(i).modn(SHARD_COUNT) as Shard;
    shards.push(shard);
  }
  shards.map((shard: Shard) => {
    if (state.latestCrosslinks[shard.toNumber()].epoch <= state.validatorRegistryUpdateEpoch) {
      return false;
    }
  });
  return true;
}

/**
 * Process the slashings.
 * @param {BeaconState} state
 */
export function processSlashing(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const activeValidatorIndices = getActiveValidatorIndices(state.validatorRegistry, currentEpoch);
  const totalBalance = activeValidatorIndices.reduce((acc, cur) => acc.add(getEffectiveBalance(state, cur)), new BN(0));

}

/**
 * Updates the validator registry
 * @param {BeaconState} state
 */
export function updateValidatorRegistry(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  // The active validators
  const activeValidatorIndices = getActiveValidatorIndices(state.validatorRegistry, currentEpoch);
  // The total effective balance of active validators
  const totalBalance = getTotalBalance(state, activeValidatorIndices);

  // The maximum balance chrun in Gwei (for deposits and exists separately)
  const a = new BN(MAX_DEPOSIT_AMOUNT);
  const b = totalBalance.divn(2 * MAX_BALANCE_CHURN_QUOTIENT);
  const maxBalanceChrun = a.gt(b) ? a : b;

  // Activate validators within the allowable balance churn
  let balanceChurn = new BN(0);
  state.validatorRegistry.forEach((validator, index) => {
    if (validator.activationEpoch > getEntryExitEffectEpoch(currentEpoch) && state.validatorBalances[index].lten(MAX_DEPOSIT_AMOUNT)) {
      // Check the balance churn would be within the allowance
      balanceChurn = balanceChurn.add(getEffectiveBalance(state, new BN(index)));
      if (balanceChurn.gt(maxBalanceChrun)) {
        return;
      }
      // Activate Validator
      activateValidator(state, new BN(index), false);
    }
  });

  // Exit validators within the allowable balance churn
  balanceChurn = new BN(0);
  state.validatorRegistry.forEach((validator, index) => {
    if (validator.exitEpoch > getEntryExitEffectEpoch(currentEpoch) && validator.statusFlags.and(INITIATED_EXIT)) {
      // Check the balance churn would be within the allowance
      balanceChurn = balanceChurn.add(getEffectiveBalance(state, new BN(index)));
      if (balanceChurn.gt(maxBalanceChrun)) {
        return;
      }
      // Exit Validator
      exitValidator(state, index);
    }
  });

  state.validatorRegistryUpdateEpoch = currentEpoch;
}

/**
 * Iterate through the validator registry and eject active validators with balance below EJECTION_BALANCE.
 * @param {BeaconState} state
 */
export function processEjections(state: BeaconState): void {
  for (let index of getActiveValidatorIndices(state.validatorRegistry, getCurrentEpoch(state))) {
    if (state.validatorBalances[index.toNumber()].ltn(EJECTION_BALANCE)) {
      exitValidator(state, index);
    }
  }
}
