import {byteArrayEquals} from "@chainsafe/ssz";
import {
  FAR_FUTURE_EPOCH,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP,
  MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";
import {ValidatorIndex, capella, ssz} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {CachedBeaconStateCapella, CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {isBuilderPaymentWithdrawable, isParentBlockFull} from "../util/gloas.ts";
import {
  decreaseBalance,
  getMaxEffectiveBalance,
  hasEth1WithdrawalCredential,
  hasExecutionWithdrawalCredential,
  isCapellaPayloadHeader,
} from "../util/index.js";

export function processWithdrawals(
  fork: ForkSeq,
  state: CachedBeaconStateCapella | CachedBeaconStateElectra | CachedBeaconStateGloas,
  payload?: capella.FullOrBlindedExecutionPayload
): void {
  // Return early if the parent block is empty
  if (fork >= ForkSeq.gloas && !isParentBlockFull(state as CachedBeaconStateGloas)) {
    return;
  }

  // processedPartialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
  // processedBuilderWithdrawalsCount is withdrawals coming from builder payment since gloas (EIP-7732)
  const {
    withdrawals: expectedWithdrawals,
    processedValidatorsSweepCount,
    processedPartialWithdrawalsCount,
    processedBuilderWithdrawalsCount,
  } = getExpectedWithdrawals(fork, state);
  const numWithdrawals = expectedWithdrawals.length;

  // After gloas, withdrawals are verified later in processExecutionPayloadEnvelope
  if (fork < ForkSeq.gloas) {
    if (payload === undefined) {
      throw Error("payload is required for pre-gloas processWithdrawals");
    }

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
  }

  for (let i = 0; i < numWithdrawals; i++) {
    const withdrawal = expectedWithdrawals[i];
    decreaseBalance(state, withdrawal.validatorIndex, Number(withdrawal.amount));
  }

  if (fork >= ForkSeq.electra) {
    const stateElectra = state as CachedBeaconStateElectra;
    stateElectra.pendingPartialWithdrawals = stateElectra.pendingPartialWithdrawals.sliceFrom(
      processedPartialWithdrawalsCount
    );
  }

  if (fork >= ForkSeq.gloas) {
    const stateGloas = state as CachedBeaconStateGloas;
    stateGloas.latestWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(expectedWithdrawals);

    const unprocessedWithdrawals = stateGloas.builderPendingWithdrawals
      .getAllReadonly()
      .slice(0, processedBuilderWithdrawalsCount)
      .filter((w) => !isBuilderPaymentWithdrawable(stateGloas, w));
    const remainingWithdrawals = stateGloas.builderPendingWithdrawals
      .sliceFrom(processedBuilderWithdrawalsCount)
      .getAllReadonly();

    stateGloas.builderPendingWithdrawals = ssz.gloas.BeaconState.fields.builderPendingWithdrawals.toViewDU([
      ...unprocessedWithdrawals,
      ...remainingWithdrawals,
    ]);
  }

  // Update the nextWithdrawalIndex
  const latestWithdrawal = expectedWithdrawals.at(-1);
  if (latestWithdrawal) {
    state.nextWithdrawalIndex = latestWithdrawal.index + 1;
  }

  // Update the nextWithdrawalValidatorIndex
  const nextIndex = state.nextWithdrawalValidatorIndex + processedValidatorsSweepCount;
  state.nextWithdrawalValidatorIndex = nextIndex % state.validators.length;
}

export function getExpectedWithdrawals(
  fork: ForkSeq,
  state: CachedBeaconStateCapella | CachedBeaconStateElectra | CachedBeaconStateGloas
): {
  withdrawals: capella.Withdrawal[];
  processedValidatorsSweepCount: number;
  processedPartialWithdrawalsCount: number;
  processedBuilderWithdrawalsCount: number;
} {
  if (fork < ForkSeq.capella) {
    throw new Error(`getExpectedWithdrawals not supported at forkSeq=${fork} < ForkSeq.capella`);
  }

  const epoch = state.epochCtx.epoch;
  let withdrawalIndex = state.nextWithdrawalIndex;
  const {validators, balances, nextWithdrawalValidatorIndex} = state;

  const withdrawals: capella.Withdrawal[] = [];
  const withdrawnBalances = new MapDef<ValidatorIndex, number>(() => 0);
  const isPostElectra = fork >= ForkSeq.electra;
  const isPostGloas = fork >= ForkSeq.gloas;
  // partialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
  let processedPartialWithdrawalsCount = 0;
  // builderWithdrawalsCount is withdrawals coming from builder payments since Gloas (EIP-7732)
  let processedBuilderWithdrawalsCount = 0;

  if (isPostGloas) {
    const stateGloas = state as CachedBeaconStateGloas;

    const allBuilderPendingWithdrawals =
      stateGloas.builderPendingWithdrawals.length <= MAX_WITHDRAWALS_PER_PAYLOAD
        ? stateGloas.builderPendingWithdrawals.getAllReadonly()
        : null;

    for (let i = 0; i < stateGloas.builderPendingWithdrawals.length; i++) {
      const withdrawal = allBuilderPendingWithdrawals
        ? allBuilderPendingWithdrawals[i]
        : stateGloas.builderPendingWithdrawals.getReadonly(i);

      if (withdrawal.withdrawableEpoch > epoch || withdrawals.length + 1 === MAX_WITHDRAWALS_PER_PAYLOAD) {
        break;
      }

      if (isBuilderPaymentWithdrawable(stateGloas, withdrawal)) {
        const totalWithdrawn = withdrawnBalances.getOrDefault(withdrawal.builderIndex);
        const balance = state.balances.get(withdrawal.builderIndex) - totalWithdrawn;
        const builder = state.validators.get(withdrawal.builderIndex);

        let withdrawableBalance = 0;

        if (builder.slashed) {
          withdrawableBalance = balance < withdrawal.amount ? balance : withdrawal.amount;
        } else if (balance > MIN_ACTIVATION_BALANCE) {
          withdrawableBalance =
            balance - MIN_ACTIVATION_BALANCE < withdrawal.amount ? balance - MIN_ACTIVATION_BALANCE : withdrawal.amount;
        }

        if (withdrawableBalance > 0) {
          withdrawals.push({
            index: withdrawalIndex,
            validatorIndex: withdrawal.builderIndex,
            address: withdrawal.feeRecipient,
            amount: BigInt(withdrawableBalance),
          });
          withdrawalIndex++;
          withdrawnBalances.set(withdrawal.builderIndex, totalWithdrawn + withdrawableBalance);
        }
      }
      processedBuilderWithdrawalsCount++;
    }
  }

  if (isPostElectra) {
    // In pre-gloas, partialWithdrawalBound == MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP
    const partialWithdrawalBound = Math.min(
      withdrawals.length + MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP,
      MAX_WITHDRAWALS_PER_PAYLOAD - 1
    );
    const stateElectra = state as CachedBeaconStateElectra;

    // MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP = 8, PENDING_PARTIAL_WITHDRAWALS_LIMIT: 134217728 so we should only call getAllReadonly() if it makes sense
    // pendingPartialWithdrawals comes from EIP-7002 smart contract where it takes fee so it's more likely than not validator is in correct condition to withdraw
    // also we may break early if withdrawableEpoch > epoch
    const allPendingPartialWithdrawals =
      stateElectra.pendingPartialWithdrawals.length <= partialWithdrawalBound
        ? stateElectra.pendingPartialWithdrawals.getAllReadonly()
        : null;

    // EIP-7002: Execution layer triggerable withdrawals
    for (let i = 0; i < stateElectra.pendingPartialWithdrawals.length; i++) {
      const withdrawal = allPendingPartialWithdrawals
        ? allPendingPartialWithdrawals[i]
        : stateElectra.pendingPartialWithdrawals.getReadonly(i);
      if (withdrawal.withdrawableEpoch > epoch || withdrawals.length === partialWithdrawalBound) {
        break;
      }

      const validator = validators.getReadonly(withdrawal.validatorIndex);
      const totalWithdrawn = withdrawnBalances.getOrDefault(withdrawal.validatorIndex);
      const balance = state.balances.get(withdrawal.validatorIndex) - totalWithdrawn;

      // is_eligible_for_partial_withdrawals
      if (
        validator.exitEpoch === FAR_FUTURE_EPOCH &&
        validator.effectiveBalance >= MIN_ACTIVATION_BALANCE &&
        balance > MIN_ACTIVATION_BALANCE
      ) {
        const balanceOverMinActivationBalance = BigInt(balance - MIN_ACTIVATION_BALANCE);
        const withdrawableBalance =
          balanceOverMinActivationBalance < withdrawal.amount ? balanceOverMinActivationBalance : withdrawal.amount;
        withdrawals.push({
          index: withdrawalIndex,
          validatorIndex: withdrawal.validatorIndex,
          address: validator.withdrawalCredentials.subarray(12),
          amount: withdrawableBalance,
        });
        withdrawalIndex++;
        withdrawnBalances.set(withdrawal.validatorIndex, totalWithdrawn + Number(withdrawableBalance));
      }
      processedPartialWithdrawalsCount++;
    }
  }

  // get_validators_sweep_withdrawals
  const validatorsLimit = Math.min(validators.length, MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP);
  const withdrawalsLimit = MAX_WITHDRAWALS_PER_PAYLOAD;

  let processedValidatorsSweepCount = 0;
  let validatorIndex = nextWithdrawalValidatorIndex;

  for (let i = 0; i < validatorsLimit; i++) {
    if (withdrawals.length === withdrawalsLimit) {
      break;
    }

    const validator = validators.getReadonly(validatorIndex);
    const withdrawnBalance = withdrawnBalances.getOrDefault(validatorIndex);
    // get_balance_after_withdrawals
    const balance = balances.get(validatorIndex) - withdrawnBalance;
    const {withdrawableEpoch, withdrawalCredentials, effectiveBalance} = validator;
    const hasWithdrawableCredentials = isPostElectra
      ? hasExecutionWithdrawalCredential(withdrawalCredentials)
      : hasEth1WithdrawalCredential(withdrawalCredentials);

    // Early skip for balance = 0 as it's now more likely that validator has exited/slashed with
    // balance zero than not having withdrawal credentials set
    if (balance === 0 || !hasWithdrawableCredentials) {
      validatorIndex = (validatorIndex + 1) % validators.length;
      processedValidatorsSweepCount++;
      continue;
    }

    // is_fully_withdrawable_validator
    if (withdrawableEpoch <= epoch) {
      withdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.subarray(12),
        amount: BigInt(balance),
      });
      withdrawalIndex++;
      withdrawnBalances.set(validatorIndex, withdrawnBalance + balance);
    }
    // is_partially_withdrawable_validator
    else {
      const maxEffectiveBalance = isPostElectra ? getMaxEffectiveBalance(withdrawalCredentials) : MAX_EFFECTIVE_BALANCE;
      if (effectiveBalance === maxEffectiveBalance && balance > maxEffectiveBalance) {
        const withdrawableBalance = balance - maxEffectiveBalance;
        withdrawals.push({
          index: withdrawalIndex,
          validatorIndex,
          address: validator.withdrawalCredentials.subarray(12),
          amount: BigInt(withdrawableBalance),
        });
        withdrawalIndex++;
        withdrawnBalances.set(validatorIndex, withdrawnBalance + withdrawableBalance);
      }
    }

    validatorIndex = (validatorIndex + 1) % validators.length;
    processedValidatorsSweepCount++;
  }

  return {
    withdrawals,
    processedValidatorsSweepCount,
    processedPartialWithdrawalsCount,
    processedBuilderWithdrawalsCount,
  };
}
