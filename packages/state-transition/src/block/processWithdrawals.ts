import {ssz, capella} from "@lodestar/types";
import {
  MAX_EFFECTIVE_BALANCE,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP,
} from "@lodestar/params";
import {byteArrayEquals, toHexString} from "@chainsafe/ssz";

import {CachedBeaconStateCapella} from "../types.js";
import {decreaseBalance, hasEth1WithdrawalCredential, isCapellaPayloadHeader} from "../util/index.js";

export function processWithdrawals(
  state: CachedBeaconStateCapella,
  payload: capella.FullOrBlindedExecutionPayload
): void {
  const {withdrawals: expectedWithdrawals} = getExpectedWithdrawals(state);
  const numWithdrawals = expectedWithdrawals.length;

  if (isCapellaPayloadHeader(payload)) {
    const expectedWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(expectedWithdrawals);
    const actualWithdrawalsRoot = payload.withdrawalsRoot;
    if (!byteArrayEquals(expectedWithdrawalsRoot, actualWithdrawalsRoot)) {
      throw Error(
        `Invalid withdrawalsRoot of executionPayloadHeader, expected=${toHexString(
          expectedWithdrawalsRoot
        )}, actual=${toHexString(actualWithdrawalsRoot)}`
      );
    }
  } else {
    if (expectedWithdrawals.length !== payload.withdrawals.length) {
      throw Error(`Invalid withdrawals length expected=${numWithdrawals} actual=${payload.withdrawals.length}`);
    }
    for (let i = 0; i < numWithdrawals; i++) {
      const withdrawal = expectedWithdrawals[i];
      if (!ssz.capella.Withdrawal.equals(withdrawal, payload.withdrawals[i])) {
        throw Error(`Withdrawal mismatch at index=${i}`);
      }
    }
  }

  for (let i = 0; i < numWithdrawals; i++) {
    const withdrawal = expectedWithdrawals[i];
    decreaseBalance(state, withdrawal.validatorIndex, Number(withdrawal.amount));
  }

  // Update the nextWithdrawalIndex
  if (expectedWithdrawals.length > 0) {
    const latestWithdrawal = expectedWithdrawals[expectedWithdrawals.length - 1];
    state.nextWithdrawalIndex = latestWithdrawal.index + 1;
  }

  // Update the nextWithdrawalValidatorIndex
  if (expectedWithdrawals.length === MAX_WITHDRAWALS_PER_PAYLOAD) {
    // All slots filled, nextWithdrawalValidatorIndex should be validatorIndex having next turn
    const latestWithdrawal = expectedWithdrawals[expectedWithdrawals.length - 1];
    state.nextWithdrawalValidatorIndex = (latestWithdrawal.validatorIndex + 1) % state.validators.length;
  } else {
    // expected withdrawals came up short in the bound, so we move nextWithdrawalValidatorIndex to
    // the next post the bound
    state.nextWithdrawalValidatorIndex =
      (state.nextWithdrawalValidatorIndex + MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP) % state.validators.length;
  }
}

export function getExpectedWithdrawals(
  state: CachedBeaconStateCapella
): {withdrawals: capella.Withdrawal[]; sampledValidators: number} {
  const epoch = state.epochCtx.epoch;
  let withdrawalIndex = state.nextWithdrawalIndex;
  const {validators, balances, nextWithdrawalValidatorIndex} = state;
  const bound = Math.min(validators.length, MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP);

  let n = 0;

  const withdrawals: capella.Withdrawal[] = [];
  // Just run a bounded loop max iterating over all withdrawals
  // however breaks out once we have MAX_WITHDRAWALS_PER_PAYLOAD
  for (n = 0; n < bound; n++) {
    // Get next validator in turn
    const validatorIndex = (nextWithdrawalValidatorIndex + n) % validators.length;

    // It's most likely for validators to not have set eth1 credentials, than having 0 balance
    const validator = validators.getReadonly(validatorIndex);
    if (!hasEth1WithdrawalCredential(validator.withdrawalCredentials)) {
      continue;
    }

    const balance = balances.get(validatorIndex);

    if (balance > 0 && validator.withdrawableEpoch <= epoch) {
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.slice(12),
        amount: BigInt(balance),
      });
      withdrawalIndex++;
    } else if (validator.effectiveBalance === MAX_EFFECTIVE_BALANCE && balance > MAX_EFFECTIVE_BALANCE) {
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
  }

  return {withdrawals, sampledValidators: n};
}
