import {byteArrayEquals, toHexString} from "@chainsafe/ssz";
import {ssz, capella} from "@lodestar/types";
import {
  MAX_EFFECTIVE_BALANCE,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP,
  ForkSeq,
  MAX_PARTIAL_WITHDRAWALS_PER_PAYLOAD,
  FAR_FUTURE_EPOCH,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";

import {CachedBeaconStateCapella, CachedBeaconStateElectra} from "../types.js";
import {decreaseBalance, getValidatorExcessBalance, hasCompoundingWithdrawalCredential, hasEth1WithdrawalCredential, hasExecutionWithdrawalCredential, isCapellaPayloadHeader, isFullyWithdrawableValidator, isPartiallyWithdrawableValidator} from "../util/index.js";

export function processWithdrawals(
  fork: ForkSeq,
  state: CachedBeaconStateCapella | CachedBeaconStateElectra,
  payload: capella.FullOrBlindedExecutionPayload
): void {
  // const {withdrawals: expectedWithdrawals, partialWithdrawalsCount} = getExpectedWithdrawals(fork, state);
  const {withdrawals: expectedWithdrawals} = getExpectedWithdrawals(fork, state);
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

  if (fork >= ForkSeq.electra) {
    const stateElectra = state as CachedBeaconStateElectra;
    // TODO Electra: stateElectra.pendingPartialWithdrawals need to implement slicing mechanism for ListCompositeTreeViewDU
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

export function getExpectedWithdrawals(fork: ForkSeq, state: CachedBeaconStateCapella | CachedBeaconStateElectra): {
  withdrawals: capella.Withdrawal[];
  sampledValidators: number;
  partialWithdrawalsCount: number;
} {
  const epoch = state.epochCtx.epoch;
  let withdrawalIndex = state.nextWithdrawalIndex;
  const {validators, balances, nextWithdrawalValidatorIndex} = state;
  const bound = Math.min(validators.length, MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP);


  const withdrawals: capella.Withdrawal[] = [];

  if (fork >= ForkSeq.electra) {
    const stateElectra = state as CachedBeaconStateElectra;

    for (const withdrawal of stateElectra.pendingPartialWithdrawals.getAllReadonly()) {
      if (withdrawal.withdrawableEpoch > epoch || withdrawals.length === MAX_PARTIAL_WITHDRAWALS_PER_PAYLOAD) {
        break;
      }

      const validator = validators.getReadonly(withdrawal.index);

      if (validator.exitEpoch === FAR_FUTURE_EPOCH && balances.get(withdrawalIndex) > MIN_ACTIVATION_BALANCE) {
        const balanceOverMinActivationBalance = BigInt(balances.get(withdrawalIndex) - MIN_ACTIVATION_BALANCE);
        const withdrawableBalance = balanceOverMinActivationBalance < withdrawal.amount ? balanceOverMinActivationBalance : withdrawal.amount;
        withdrawals.push({
          index: withdrawalIndex,
          validatorIndex: withdrawal.index,
          address: validator.withdrawalCredentials.slice(12),
          amount: withdrawableBalance,
        })
        withdrawalIndex++;
      }
    }

  }

  const partialWithdrawalsCount = withdrawals.length;
  let n = 0;
  // Just run a bounded loop max iterating over all withdrawals
  // however breaks out once we have MAX_WITHDRAWALS_PER_PAYLOAD
  for (n = 0; n < bound; n++) {
    // Get next validator in turn
    const validatorIndex = (nextWithdrawalValidatorIndex + n) % validators.length;

    // It's most likely for validators to not have set eth1 credentials, than having 0 balance
    const validator = validators.getReadonly(validatorIndex);
    if ((fork === ForkSeq.capella || fork === ForkSeq.deneb) && !hasEth1WithdrawalCredential(validator.withdrawalCredentials)) {
      continue;
    }
    if (fork === ForkSeq.electra && !hasExecutionWithdrawalCredential(validator.withdrawalCredentials)) {
      continue;
    }

    const balance = balances.get(validatorIndex);

    if (isFullyWithdrawableValidator(fork, validator, balance, epoch)) {
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.slice(12),
        amount: BigInt(balance),
      });
      withdrawalIndex++;
    } else if (isPartiallyWithdrawableValidator(fork, validator, balance, epoch)) {
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.slice(12),
        amount: BigInt(getValidatorExcessBalance(validator.withdrawalCredentials, balance)),
      });
      withdrawalIndex++;
    }

    // Break if we have enough to pack the block
    if (withdrawals.length >= MAX_WITHDRAWALS_PER_PAYLOAD) {
      break;
    }
  }

  return {withdrawals, sampledValidators: n, partialWithdrawalsCount};
}
