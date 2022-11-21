import {ssz, capella} from "@lodestar/types";
import {MAX_EFFECTIVE_BALANCE, MAX_WITHDRAWALS_PER_PAYLOAD, EFFECTIVE_BALANCE_INCREMENT} from "@lodestar/params";

import {CachedBeaconStateCapella} from "../types.js";
import {decreaseBalance} from "../util/index.js";

const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;

export function processWithdrawals(
  state: CachedBeaconStateCapella,
  payload: capella.FullOrBlindedExecutionPayload
): void {
  const expectedWithdrawals = getExpectedWithdrawals(state);
  const numWithdrawals = expectedWithdrawals.length;

  if (expectedWithdrawals.length !== payload.withdrawals.length) {
    throw Error(`Invalid withdrawals length expected=${numWithdrawals} actual=${payload.withdrawals.length}`);
  }
  for (let i = 0; i < numWithdrawals; i++) {
    const withdrawal = expectedWithdrawals[i];
    if (!ssz.capella.Withdrawal.equals(withdrawal, payload.withdrawals[i])) {
      throw Error(`Withdrawal mismatch at index=${i}`);
    }
    decreaseBalance(state, withdrawal.validatorIndex, Number(withdrawal.amount));
  }
  if (expectedWithdrawals.length > 0) {
    const latestWithdrawal = expectedWithdrawals[expectedWithdrawals.length - 1];
    state.nextWithdrawalIndex = latestWithdrawal.index + 1;
    state.nextWithdrawalValidatorIndex = (latestWithdrawal.validatorIndex + 1) % state.validators.length;
  }
}

export function getExpectedWithdrawals(state: CachedBeaconStateCapella): capella.Withdrawal[] {
  const epoch = state.epochCtx.epoch;
  let withdrawalIndex = state.nextWithdrawalIndex;
  let validatorIndex = state.nextWithdrawalValidatorIndex;
  const {effectiveBalanceIncrements, eth1WithdrawalCredentialCache} = state.epochCtx;
  const {validators, balances} = state;

  const withdrawals: capella.Withdrawal[] = [];
  // Just run a bounded loop max iterating over all withdrawals
  // however breaks out once we have MAX_WITHDRAWALS_PER_PAYLOAD
  for (let k = 0; k < validators.length; k++) {
    // Spec https://github.com/ethereum/consensus-specs/blob/3d235740e5f1e641d3b160c8688f26e7dc5a1894/specs/capella/beacon-chain.md#is_fully_withdrawable_validator
    // Withdraw validators if either:
    // - `is_fully_withdrawable_validator`:
    //      has_eth1_withdrawal_credential(validator)
    //      and validator.withdrawable_epoch <= epoch
    //      and balance > 0
    // - `is_partially_withdrawable_validator`
    //      has_eth1_withdrawal_credential(validator)
    //      validator.effective_balance == MAX_EFFECTIVE_BALANCE
    //      balance > MAX_EFFECTIVE_BALANCE
    //
    // This function may loop over the entire validator set **every block** given specific network conditions.
    // That is very rare to happen, but it would be very costly. This function must do as little work as possible
    // per validator index while searching for withdrawable validators. Dangerous cases:
    // - No index has set has_eth1_withdrawal_credential()
    // - The entire network starts leaking, so no validator can be partially withdrawn
    //
    // value                          | when changes? | can change multiple times?
    // ------------------------------ | ------------- | ---------------------------
    // has_eth1_withdrawal_credential | on slot       | can only be set once
    // validator.withdrawable_epoch   | on epoch      | can only be set once
    // effective_balance              | on epoch      | changes continuously
    // balance                        | on slot       | changes continuously

    const balance = balances.get(validatorIndex);

    // full withdrawal requires `balance > 0`, partial withdrawal requires `balance > MAX_EFFECTIVE_BALANCE`
    // This early return covers validators that already withdrawn
    if (balance === 0) {
      continue;
    }

    // Both withdrawals require eth1 credentials.
    // This early return covers validators that have not already switched
    if (!eth1WithdrawalCredentialCache.has(validatorIndex)) {
      continue;
    }

    const validator = validators.getReadonly(validatorIndex);
    const effectiveBalanceIncrement = effectiveBalanceIncrements[validatorIndex];

    // if is_fully_withdrawable_validator(validator, balance, epoch):
    // Note: Already checked that has_eth1_withdrawal_credential() above
    if (balance > 0 && validator.withdrawableEpoch <= epoch) {
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.slice(12),
        amount: BigInt(balance),
      });
      withdrawalIndex++;
    }

    // if is_partially_withdrawable_validator(validator, balance):
    // Note: Already checked that has_eth1_withdrawal_credential() above
    else if (effectiveBalanceIncrement === MAX_EFFECTIVE_BALANCE_INCREMENT && balance > MAX_EFFECTIVE_BALANCE) {
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.slice(12),
        amount: BigInt(balance - MAX_EFFECTIVE_BALANCE),
      });
      withdrawalIndex++;
    }

    // Break if we have enough to pack the block
    if (withdrawals.length >= MAX_WITHDRAWALS_PER_PAYLOAD) {
      break;
    }
    // Get next validator in turn
    validatorIndex = (validatorIndex + 1) % validators.length;
  }
  return withdrawals;
}
