import {byteArrayEquals} from "@chainsafe/ssz";
import {ssz, capella} from "@lodestar/types";
import {
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP,
  ForkSeq,
  MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP,
  FAR_FUTURE_EPOCH,
  MIN_ACTIVATION_BALANCE,
  MAX_EFFECTIVE_BALANCE,
} from "@lodestar/params";

import {toRootHex} from "@lodestar/utils";
import {CachedBeaconStateCapella, CachedBeaconStateElectra} from "../types.js";
import {
  decreaseBalance,
  getMaxEffectiveBalance,
  hasEth1WithdrawalCredential,
  hasExecutionWithdrawalCredential,
  isCapellaPayloadHeader,
} from "../util/index.js";

export function processWithdrawals(
  fork: ForkSeq,
  state: CachedBeaconStateCapella | CachedBeaconStateElectra,
  payload: capella.FullOrBlindedExecutionPayload
): void {
  // partialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
  // TODO - electra: may switch to executionWithdrawalsCount
  const {withdrawals: expectedWithdrawals, partialWithdrawalsCount} = getExpectedWithdrawals(fork, state);
  const numWithdrawals = expectedWithdrawals.length;

  if (isCapellaPayloadHeader(payload)) {
    const expectedWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(expectedWithdrawals);
    const actualWithdrawalsRoot = payload.withdrawalsRoot;
    if (!byteArrayEquals(expectedWithdrawalsRoot, actualWithdrawalsRoot)) {
      throw Error(
        `Invalid withdrawalsRoot of executionPayloadHeader, expected=${toRootHex(
          expectedWithdrawalsRoot
        )}, actual=${toRootHex(actualWithdrawalsRoot)}`
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
    stateElectra.pendingPartialWithdrawals = stateElectra.pendingPartialWithdrawals.sliceFrom(partialWithdrawalsCount);
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
  fork: ForkSeq,
  state: CachedBeaconStateCapella | CachedBeaconStateElectra
): {
  withdrawals: capella.Withdrawal[];
  sampledValidators: number;
  partialWithdrawalsCount: number;
} {
  if (fork < ForkSeq.capella) {
    throw new Error(`getExpectedWithdrawals not supported at forkSeq=${fork} < ForkSeq.capella`);
  }

  const epoch = state.epochCtx.epoch;
  let withdrawalIndex = state.nextWithdrawalIndex;
  const {validators, balances, nextWithdrawalValidatorIndex} = state;

  const withdrawals: capella.Withdrawal[] = [];
  const isPostElectra = fork >= ForkSeq.electra;
  // partialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
  let partialWithdrawalsCount = 0;

  if (isPostElectra) {
    const stateElectra = state as CachedBeaconStateElectra;

    // MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP = 8, PENDING_PARTIAL_WITHDRAWALS_LIMIT: 134217728 so we should only call getAllReadonly() if it makes sense
    // pendingPartialWithdrawals comes from EIP-7002 smart contract where it takes fee so it's more likely than not validator is in correct condition to withdraw
    // also we may break early if withdrawableEpoch > epoch
    const allPendingPartialWithdrawals =
      stateElectra.pendingPartialWithdrawals.length <= MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP
        ? stateElectra.pendingPartialWithdrawals.getAllReadonly()
        : null;

    // EIP-7002: Execution layer triggerable withdrawals
    for (let i = 0; i < stateElectra.pendingPartialWithdrawals.length; i++) {
      const withdrawal = allPendingPartialWithdrawals
        ? allPendingPartialWithdrawals[i]
        : stateElectra.pendingPartialWithdrawals.getReadonly(i);
      if (withdrawal.withdrawableEpoch > epoch || withdrawals.length === MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP) {
        break;
      }

      const validator = validators.getReadonly(withdrawal.index);

      if (
        validator.exitEpoch === FAR_FUTURE_EPOCH &&
        validator.effectiveBalance >= MIN_ACTIVATION_BALANCE &&
        balances.get(withdrawal.index) > MIN_ACTIVATION_BALANCE
      ) {
        const balanceOverMinActivationBalance = BigInt(balances.get(withdrawal.index) - MIN_ACTIVATION_BALANCE);
        const withdrawableBalance =
          balanceOverMinActivationBalance < withdrawal.amount ? balanceOverMinActivationBalance : withdrawal.amount;
        withdrawals.push({
          index: withdrawalIndex,
          validatorIndex: withdrawal.index,
          address: validator.withdrawalCredentials.subarray(12),
          amount: withdrawableBalance,
        });
        withdrawalIndex++;
      }
      partialWithdrawalsCount++;
    }
  }

  const bound = Math.min(validators.length, MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP);
  let n = 0;
  // Just run a bounded loop max iterating over all withdrawals
  // however breaks out once we have MAX_WITHDRAWALS_PER_PAYLOAD
  for (n = 0; n < bound; n++) {
    // Get next validator in turn
    const validatorIndex = (nextWithdrawalValidatorIndex + n) % validators.length;

    const validator = validators.getReadonly(validatorIndex);
    const balance = balances.get(validatorIndex);
    const {withdrawableEpoch, withdrawalCredentials, effectiveBalance} = validator;
    const hasWithdrawableCredentials = isPostElectra
      ? hasExecutionWithdrawalCredential(withdrawalCredentials)
      : hasEth1WithdrawalCredential(withdrawalCredentials);
    // early skip for balance = 0 as its now more likely that validator has exited/slahed with
    // balance zero than not have withdrawal credentials set
    if (balance === 0 || !hasWithdrawableCredentials) {
      continue;
    }

    // capella full withdrawal
    if (withdrawableEpoch <= epoch) {
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.subarray(12),
        amount: BigInt(balance),
      });
      withdrawalIndex++;
    } else if (
      effectiveBalance === (isPostElectra ? getMaxEffectiveBalance(withdrawalCredentials) : MAX_EFFECTIVE_BALANCE) &&
      balance > effectiveBalance
    ) {
      // capella partial withdrawal
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.subarray(12),
        amount: BigInt(balance - effectiveBalance),
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
