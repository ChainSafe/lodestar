import {byteArrayEquals} from "@chainsafe/ssz";
import {
  FAR_FUTURE_EPOCH,
  ForkSeq,
  MAX_BUILDERS_PER_WITHDRAWALS_SWEEP,
  MAX_EFFECTIVE_BALANCE,
  MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP,
  MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";
import {BuilderIndex, ValidatorIndex, capella, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {CachedBeaconStateCapella, CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {
  convertBuilderIndexToValidatorIndex,
  convertValidatorIndexToBuilderIndex,
  isBuilderIndex,
  isParentBlockFull,
} from "../util/gloas.ts";
import {
  decreaseBalance,
  getMaxEffectiveBalance,
  hasEth1WithdrawalCredential,
  hasExecutionWithdrawalCredential,
  isCapellaPayloadHeader,
  isPartiallyWithdrawableValidator,
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

  // processedBuilderWithdrawalsCount is withdrawals coming from builder payment since gloas (EIP-7732)
  // processedPartialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
  // processedBuildersSweepCount is withdrawals from builder sweep since gloas (EIP-7732)
  // processedValidatorSweepCount is withdrawals coming from validator sweep
  const {
    expectedWithdrawals,
    processedBuilderWithdrawalsCount,
    processedPartialWithdrawalsCount,
    processedBuildersSweepCount,
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

  applyWithdrawals(state, expectedWithdrawals);

  if (fork >= ForkSeq.electra) {
    // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.0/specs/electra/beacon-chain.md#new-update_pending_partial_withdrawals
    const stateElectra = state as CachedBeaconStateElectra;
    stateElectra.pendingPartialWithdrawals = stateElectra.pendingPartialWithdrawals.sliceFrom(
      processedPartialWithdrawalsCount
    );
  }

  if (fork >= ForkSeq.gloas) {
    const stateGloas = state as CachedBeaconStateGloas;

    // Store expected withdrawals for verification
    stateGloas.payloadExpectedWithdrawals = ssz.capella.Withdrawals.toViewDU(expectedWithdrawals);

    // Update builder pending withdrawals queue
    stateGloas.builderPendingWithdrawals = stateGloas.builderPendingWithdrawals.sliceFrom(
      processedBuilderWithdrawalsCount
    );

    // Update next builder index for sweep
    if (stateGloas.builders.length > 0) {
      const nextIndex = stateGloas.nextWithdrawalBuilderIndex + processedBuildersSweepCount;
      stateGloas.nextWithdrawalBuilderIndex = nextIndex % stateGloas.builders.length;
    }
  }
  // Update the nextWithdrawalIndex
  // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.0/specs/capella/beacon-chain.md#new-update_next_withdrawal_index
  const latestWithdrawal = expectedWithdrawals.at(-1);
  if (latestWithdrawal) {
    state.nextWithdrawalIndex = latestWithdrawal.index + 1;
  }

  // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.0/specs/capella/beacon-chain.md#new-update_next_withdrawal_validator_index
  // Update the nextWithdrawalValidatorIndex
  if (latestWithdrawal && expectedWithdrawals.length === MAX_WITHDRAWALS_PER_PAYLOAD) {
    // All slots filled, nextWithdrawalValidatorIndex should be validatorIndex having next turn
    state.nextWithdrawalValidatorIndex = (latestWithdrawal.validatorIndex + 1) % state.validators.length;
  } else {
    // expected withdrawals came up short in the bound, so we move nextWithdrawalValidatorIndex to
    // the next post the bound
    state.nextWithdrawalValidatorIndex =
      (state.nextWithdrawalValidatorIndex + MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP) % state.validators.length;
  }
}

function getBuilderWithdrawals(
  state: CachedBeaconStateGloas,
  withdrawalIndex: number,
  priorWithdrawals: capella.Withdrawal[],
  builderBalanceAfterWithdrawals: Map<number, number>
): {builderWithdrawals: capella.Withdrawal[]; withdrawalIndex: number; processedCount: number} {
  const withdrawalsLimit = MAX_WITHDRAWALS_PER_PAYLOAD - 1;
  const builderWithdrawals: capella.Withdrawal[] = [];
  const allBuilderPendingWithdrawals =
    state.builderPendingWithdrawals.length <= MAX_WITHDRAWALS_PER_PAYLOAD
      ? state.builderPendingWithdrawals.getAllReadonly()
      : null;

  let processedCount = 0;
  for (let i = 0; i < state.builderPendingWithdrawals.length; i++) {
    // Check combined length against limit
    const allWithdrawals = priorWithdrawals.length + builderWithdrawals.length;
    if (allWithdrawals >= withdrawalsLimit) {
      break;
    }

    const withdrawal = allBuilderPendingWithdrawals
      ? allBuilderPendingWithdrawals[i]
      : state.builderPendingWithdrawals.getReadonly(i);

    const builderIndex = withdrawal.builderIndex;

    // Get builder balance (from builder.balance, not state.balances)
    let balance = builderBalanceAfterWithdrawals.get(builderIndex);
    if (balance === undefined) {
      balance = state.builders.getReadonly(builderIndex).balance;
      builderBalanceAfterWithdrawals.set(builderIndex, balance);
    }

    // Use the withdrawal amount directly as specified in the spec
    builderWithdrawals.push({
      index: withdrawalIndex,
      validatorIndex: convertBuilderIndexToValidatorIndex(builderIndex),
      address: withdrawal.feeRecipient,
      amount: BigInt(withdrawal.amount),
    });
    withdrawalIndex++;
    builderBalanceAfterWithdrawals.set(builderIndex, balance - withdrawal.amount);

    processedCount++;
  }

  return {builderWithdrawals, withdrawalIndex, processedCount};
}

function getBuildersSweepWithdrawals(
  state: CachedBeaconStateGloas,
  withdrawalIndex: number,
  numPriorWithdrawal: number,
  builderBalanceAfterWithdrawals: Map<number, number>
): {buildersSweepWithdrawals: capella.Withdrawal[]; withdrawalIndex: number; processedCount: number} {
  const withdrawalsLimit = MAX_WITHDRAWALS_PER_PAYLOAD - 1;
  const buildersSweepWithdrawals: capella.Withdrawal[] = [];
  const epoch = state.epochCtx.epoch;
  const builders = state.builders;

  // Return early if no builders
  if (builders.length === 0) {
    return {buildersSweepWithdrawals, withdrawalIndex, processedCount: 0};
  }

  const buildersLimit = Math.min(builders.length, MAX_BUILDERS_PER_WITHDRAWALS_SWEEP);
  let processedCount = 0;

  for (let n = 0; n < buildersLimit; n++) {
    if (buildersSweepWithdrawals.length + numPriorWithdrawal >= withdrawalsLimit) {
      break;
    }

    // Get next builder in turn
    const builderIndex = (state.nextWithdrawalBuilderIndex + n) % builders.length;
    const builder = builders.getReadonly(builderIndex);

    // Get builder balance
    let balance = builderBalanceAfterWithdrawals.get(builderIndex);
    if (balance === undefined) {
      balance = builder.balance;
      builderBalanceAfterWithdrawals.set(builderIndex, balance);
    }

    // Check if builder is withdrawable and has balance
    if (builder.withdrawableEpoch <= epoch && balance > 0) {
      // Withdraw full balance to builder's execution address
      buildersSweepWithdrawals.push({
        index: withdrawalIndex,
        validatorIndex: convertBuilderIndexToValidatorIndex(builderIndex),
        address: builder.executionAddress,
        amount: BigInt(balance),
      });
      withdrawalIndex++;
      builderBalanceAfterWithdrawals.set(builderIndex, 0);
    }

    processedCount++;
  }

  return {buildersSweepWithdrawals, withdrawalIndex, processedCount};
}

function getPendingPartialWithdrawals(
  state: CachedBeaconStateElectra,
  withdrawalIndex: number,
  numPriorWithdrawal: number,
  validatorBalanceAfterWithdrawals: Map<ValidatorIndex, number>
): {pendingPartialWithdrawals: capella.Withdrawal[]; withdrawalIndex: number; processedCount: number} {
  const epoch = state.epochCtx.epoch;
  const pendingPartialWithdrawals: capella.Withdrawal[] = [];
  const validators = state.validators;

  // In pre-gloas, partialWithdrawalBound == MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP
  const partialWithdrawalBound = Math.min(
    numPriorWithdrawal + MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP,
    MAX_WITHDRAWALS_PER_PAYLOAD - 1
  );

  // MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP = 8, PENDING_PARTIAL_WITHDRAWALS_LIMIT: 134217728 so we should only call getAllReadonly() if it makes sense
  // pendingPartialWithdrawals comes from EIP-7002 smart contract where it takes fee so it's more likely than not validator is in correct condition to withdraw
  // also we may break early if withdrawableEpoch > epoch
  const allPendingPartialWithdrawals =
    state.pendingPartialWithdrawals.length <= partialWithdrawalBound
      ? state.pendingPartialWithdrawals.getAllReadonly()
      : null;

  // EIP-7002: Execution layer triggerable withdrawals
  let processedCount = 0;
  for (let i = 0; i < state.pendingPartialWithdrawals.length; i++) {
    const withdrawal = allPendingPartialWithdrawals
      ? allPendingPartialWithdrawals[i]
      : state.pendingPartialWithdrawals.getReadonly(i);
    if (
      withdrawal.withdrawableEpoch > epoch ||
      pendingPartialWithdrawals.length + numPriorWithdrawal >= partialWithdrawalBound
    ) {
      break;
    }

    const validatorIndex = withdrawal.validatorIndex;
    const validator = validators.getReadonly(validatorIndex);
    let balance = validatorBalanceAfterWithdrawals.get(validatorIndex);
    if (balance === undefined) {
      balance = state.balances.get(validatorIndex);
      validatorBalanceAfterWithdrawals.set(validatorIndex, balance);
    }

    if (
      validator.exitEpoch === FAR_FUTURE_EPOCH &&
      validator.effectiveBalance >= MIN_ACTIVATION_BALANCE &&
      balance > MIN_ACTIVATION_BALANCE
    ) {
      const balanceOverMinActivationBalance = BigInt(balance - MIN_ACTIVATION_BALANCE);
      const withdrawableBalance =
        balanceOverMinActivationBalance < withdrawal.amount ? balanceOverMinActivationBalance : withdrawal.amount;
      pendingPartialWithdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.subarray(12),
        amount: withdrawableBalance,
      });
      withdrawalIndex++;
      validatorBalanceAfterWithdrawals.set(validatorIndex, balance - Number(withdrawableBalance));
    }
    processedCount++;
  }

  return {pendingPartialWithdrawals, withdrawalIndex, processedCount};
}

function getValidatorsSweepWithdrawals(
  fork: ForkSeq,
  state: CachedBeaconStateCapella | CachedBeaconStateElectra | CachedBeaconStateGloas,
  withdrawalIndex: number,
  numPriorWithdrawal: number,
  validatorBalanceAfterWithdrawals: Map<ValidatorIndex, number>
): {sweepWithdrawals: capella.Withdrawal[]; processedCount: number} {
  const sweepWithdrawals: capella.Withdrawal[] = [];
  const epoch = state.epochCtx.epoch;
  const {validators, balances, nextWithdrawalValidatorIndex} = state;
  const isPostElectra = fork >= ForkSeq.electra;

  const validatorsLimit = Math.min(state.validators.length, MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP);
  let processedCount = 0;
  // Just run a bounded loop max iterating over all withdrawals
  // however breaks out once we have MAX_WITHDRAWALS_PER_PAYLOAD
  for (let n = 0; n < validatorsLimit; n++) {
    if (sweepWithdrawals.length + numPriorWithdrawal === MAX_WITHDRAWALS_PER_PAYLOAD) {
      break;
    }

    // Get next validator in turn
    const validatorIndex = (nextWithdrawalValidatorIndex + n) % validators.length;

    const validator = validators.getReadonly(validatorIndex);
    let balance = validatorBalanceAfterWithdrawals.get(validatorIndex);
    if (balance === undefined) {
      balance = balances.get(validatorIndex);
      validatorBalanceAfterWithdrawals.set(validatorIndex, balance);
    }

    const {withdrawableEpoch, withdrawalCredentials} = validator;
    const hasWithdrawableCredentials = isPostElectra
      ? hasExecutionWithdrawalCredential(withdrawalCredentials)
      : hasEth1WithdrawalCredential(withdrawalCredentials);
    // early skip for balance = 0 as its now more likely that validator has exited/slashed with
    // balance zero than not have withdrawal credentials set
    if (balance === 0 || !hasWithdrawableCredentials) {
      processedCount++;
      continue;
    }

    // capella full withdrawal
    if (withdrawableEpoch <= epoch) {
      sweepWithdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.subarray(12),
        amount: BigInt(balance),
      });
      withdrawalIndex++;
      validatorBalanceAfterWithdrawals.set(validatorIndex, 0);
    } else if (isPartiallyWithdrawableValidator(fork, validator, balance)) {
      // capella partial withdrawal
      const maxEffectiveBalance = isPostElectra ? getMaxEffectiveBalance(withdrawalCredentials) : MAX_EFFECTIVE_BALANCE;
      const partialAmount = balance - maxEffectiveBalance;
      sweepWithdrawals.push({
        index: withdrawalIndex,
        validatorIndex,
        address: validator.withdrawalCredentials.subarray(12),
        amount: BigInt(partialAmount),
      });
      withdrawalIndex++;
      validatorBalanceAfterWithdrawals.set(validatorIndex, balance - partialAmount);
    }
    processedCount++;
  }

  return {sweepWithdrawals, processedCount};
}

function applyWithdrawals(
  state: CachedBeaconStateCapella | CachedBeaconStateElectra | CachedBeaconStateGloas,
  withdrawals: capella.Withdrawal[]
): void {
  for (const withdrawal of withdrawals) {
    if (isBuilderIndex(withdrawal.validatorIndex)) {
      // Handle builder withdrawal
      const builderIndex = convertValidatorIndexToBuilderIndex(withdrawal.validatorIndex);
      const builder = (state as CachedBeaconStateGloas).builders.get(builderIndex);
      const withdrawalAmount = Number(withdrawal.amount);
      builder.balance -= Math.min(withdrawalAmount, builder.balance);
    } else {
      // Handle validator withdrawal
      decreaseBalance(state, withdrawal.validatorIndex, Number(withdrawal.amount));
    }
  }
}

export function getExpectedWithdrawals(
  fork: ForkSeq,
  state: CachedBeaconStateCapella | CachedBeaconStateElectra | CachedBeaconStateGloas
): {
  expectedWithdrawals: capella.Withdrawal[];
  processedBuilderWithdrawalsCount: number;
  processedPartialWithdrawalsCount: number;
  processedBuildersSweepCount: number;
  processedValidatorSweepCount: number;
} {
  if (fork < ForkSeq.capella) {
    throw new Error(`getExpectedWithdrawals not supported at forkSeq=${fork} < ForkSeq.capella`);
  }

  let withdrawalIndex = state.nextWithdrawalIndex;

  const expectedWithdrawals: capella.Withdrawal[] = [];
  // Separate maps to track balances after applying withdrawals
  // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.0/specs/capella/beacon-chain.md#new-get_balance_after_withdrawals
  const builderBalanceAfterWithdrawals = new Map<BuilderIndex, number>();
  const validatorBalanceAfterWithdrawals = new Map<ValidatorIndex, number>();
  // partialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
  let processedPartialWithdrawalsCount = 0;
  // builderWithdrawalsCount is withdrawals coming from builder payments since Gloas (EIP-7732)
  let processedBuilderWithdrawalsCount = 0;
  // buildersSweepCount is withdrawals from builder sweep since Gloas (EIP-7732)
  let processedBuildersSweepCount = 0;

  if (fork >= ForkSeq.gloas) {
    const {
      builderWithdrawals,
      withdrawalIndex: newWithdrawalIndex,
      processedCount,
    } = getBuilderWithdrawals(
      state as CachedBeaconStateGloas,
      withdrawalIndex,
      expectedWithdrawals,
      builderBalanceAfterWithdrawals
    );

    expectedWithdrawals.push(...builderWithdrawals);
    withdrawalIndex = newWithdrawalIndex;
    processedBuilderWithdrawalsCount = processedCount;
  }

  if (fork >= ForkSeq.electra) {
    const {
      pendingPartialWithdrawals,
      withdrawalIndex: newWithdrawalIndex,
      processedCount,
    } = getPendingPartialWithdrawals(
      state as CachedBeaconStateElectra,
      withdrawalIndex,
      expectedWithdrawals.length,
      validatorBalanceAfterWithdrawals
    );

    expectedWithdrawals.push(...pendingPartialWithdrawals);
    withdrawalIndex = newWithdrawalIndex;
    processedPartialWithdrawalsCount = processedCount;
  }

  if (fork >= ForkSeq.gloas) {
    const {
      buildersSweepWithdrawals,
      withdrawalIndex: newWithdrawalIndex,
      processedCount,
    } = getBuildersSweepWithdrawals(
      state as CachedBeaconStateGloas,
      withdrawalIndex,
      expectedWithdrawals.length,
      builderBalanceAfterWithdrawals
    );

    expectedWithdrawals.push(...buildersSweepWithdrawals);
    withdrawalIndex = newWithdrawalIndex;
    processedBuildersSweepCount = processedCount;
  }

  const {sweepWithdrawals, processedCount: processedValidatorSweepCount} = getValidatorsSweepWithdrawals(
    fork,
    state,
    withdrawalIndex,
    expectedWithdrawals.length,
    validatorBalanceAfterWithdrawals
  );

  expectedWithdrawals.push(...sweepWithdrawals);

  return {
    expectedWithdrawals,
    processedBuilderWithdrawalsCount,
    processedPartialWithdrawalsCount,
    processedBuildersSweepCount,
    processedValidatorSweepCount,
  };
}
