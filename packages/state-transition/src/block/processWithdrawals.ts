import {ssz, capella} from "@lodestar/types";
import {
  MAX_EFFECTIVE_BALANCE,
  WITHDRAWAL_PREFIX_BYTES,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  MAX_WITHDRAWALS_PER_PAYLOAD,
} from "@lodestar/params";
import {byteArrayEquals} from "@chainsafe/ssz";

import {CachedBeaconStateCapella} from "../types.js";
import {decreaseBalance} from "../util/index.js";

export function getExpectedWithdrawals(state: CachedBeaconStateCapella): capella.Withdrawal[] {
  const currentEpoch = state.epochCtx.epoch + 1;
  let withdrawalIndex = state.nextWithdrawalIndex;
  let validatorIndex = state.latestWithdrawalValidatorIndex;
  const {validators, balances} = state;

  const withdrawals: capella.Withdrawal[] = [];
  for (let index = 0; index < validators.length; index++) {
    // Get the index of validator next in turn
    validatorIndex = (validatorIndex + 1) % validators.length;
    const validator = validators.get(validatorIndex);
    const balance = balances.get(validatorIndex);
    const {effectiveBalance, withdrawalCredentials, withdrawableEpoch} = validator;

    if (
      ((balance > 0 && withdrawableEpoch <= currentEpoch) ||
        (effectiveBalance === MAX_EFFECTIVE_BALANCE && balance > MAX_EFFECTIVE_BALANCE)) &&
      byteArrayEquals(withdrawalCredentials.slice(0, WITHDRAWAL_PREFIX_BYTES), ETH1_ADDRESS_WITHDRAWAL_PREFIX)
    ) {
      const amount = withdrawableEpoch <= currentEpoch ? balance : balance - MAX_EFFECTIVE_BALANCE;
      const address = withdrawalCredentials.slice(12);
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address,
        amount: BigInt(amount),
      });
      withdrawalIndex++;
    }

    // Break if we have enough to pack the block
    if (withdrawals.length >= MAX_WITHDRAWALS_PER_PAYLOAD) {
      break;
    }
  }
  return withdrawals;
}

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
    const lastWithdrawal = expectedWithdrawals[expectedWithdrawals.length - 1];
    state.nextWithdrawalIndex = lastWithdrawal.index + 1;
    state.latestWithdrawalValidatorIndex = lastWithdrawal.validatorIndex;
  }
}
