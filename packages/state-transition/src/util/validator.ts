import {ChainForkConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";
import {Epoch, ValidatorIndex, phase0} from "@lodestar/types";
import {intDiv} from "@lodestar/utils";
import {BeaconStateAllForks, CachedBeaconStateElectra, CachedBeaconStateGloas, EpochCache} from "../types.js";
import {hasEth1WithdrawalCredential} from "./capella.js";
import {hasCompoundingWithdrawalCredential, hasExecutionWithdrawalCredential} from "./electra.js";

/**
 * Check if [[validator]] is active
 */
export function isActiveValidator(validator: phase0.Validator, epoch: Epoch): boolean {
  return validator.activationEpoch <= epoch && epoch < validator.exitEpoch;
}

/**
 * Check if [[validator]] is slashable
 */
export function isSlashableValidator(validator: phase0.Validator, epoch: Epoch): boolean {
  return !validator.slashed && validator.activationEpoch <= epoch && epoch < validator.withdrawableEpoch;
}

/**
 * Return the sequence of active validator indices at [[epoch]].
 *
 * NAIVE - SLOW CODE 🐢
 */
export function getActiveValidatorIndices(state: BeaconStateAllForks, epoch: Epoch): Uint32Array {
  const indices: ValidatorIndex[] = [];

  const validatorsArr = state.validators.getAllReadonlyValues();
  for (let i = 0; i < validatorsArr.length; i++) {
    if (isActiveValidator(validatorsArr[i], epoch)) {
      indices.push(i);
    }
  }

  return new Uint32Array(indices);
}

export function getActivationChurnLimit(config: ChainForkConfig, fork: ForkSeq, activeValidatorCount: number): number {
  if (fork >= ForkSeq.deneb) {
    return Math.min(config.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT, getChurnLimit(config, activeValidatorCount));
  }
  return getChurnLimit(config, activeValidatorCount);
}

export function getChurnLimit(config: ChainForkConfig, activeValidatorCount: number): number {
  return Math.max(config.MIN_PER_EPOCH_CHURN_LIMIT, intDiv(activeValidatorCount, config.CHURN_LIMIT_QUOTIENT));
}

/**
 * Get combined churn limit of activation-exit and consolidation
 */
export function getBalanceChurnLimit(
  totalActiveBalanceIncrements: number,
  churnLimitQuotient: number,
  minPerEpochChurnLimit: number
): number {
  const churnLimitByTotalActiveBalance = Math.floor(
    (totalActiveBalanceIncrements / churnLimitQuotient) * EFFECTIVE_BALANCE_INCREMENT
  );

  const churn = Math.max(churnLimitByTotalActiveBalance, minPerEpochChurnLimit);

  return churn - (churn % EFFECTIVE_BALANCE_INCREMENT);
}

export function getBalanceChurnLimitFromCache(epochCtx: EpochCache): number {
  return getBalanceChurnLimit(
    epochCtx.totalActiveBalanceIncrements,
    epochCtx.config.CHURN_LIMIT_QUOTIENT,
    epochCtx.config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA
  );
}

export function getActivationExitChurnLimit(epochCtx: EpochCache): number {
  return Math.min(epochCtx.config.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT, getBalanceChurnLimitFromCache(epochCtx));
}

export function getConsolidationChurnLimit(epochCtx: EpochCache): number {
  return getBalanceChurnLimitFromCache(epochCtx) - getActivationExitChurnLimit(epochCtx);
}

export function getMaxEffectiveBalance(withdrawalCredentials: Uint8Array): number {
  // Compounding withdrawal credential only available since Electra
  if (hasCompoundingWithdrawalCredential(withdrawalCredentials)) {
    return MAX_EFFECTIVE_BALANCE_ELECTRA;
  }
  return MIN_ACTIVATION_BALANCE;
}

/**
 * Check if validator is partially withdrawable.
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/electra/beacon-chain.md#modified-is_partially_withdrawable_validator
 */
export function isPartiallyWithdrawableValidator(fork: ForkSeq, validator: phase0.Validator, balance: number): boolean {
  const isPostElectra = fork >= ForkSeq.electra;

  // Check withdrawal credentials
  const hasWithdrawableCredentials = isPostElectra
    ? hasExecutionWithdrawalCredential(validator.withdrawalCredentials)
    : hasEth1WithdrawalCredential(validator.withdrawalCredentials);

  if (!hasWithdrawableCredentials) {
    return false;
  }

  // Get max effective balance based on fork
  const maxEffectiveBalance = isPostElectra
    ? getMaxEffectiveBalance(validator.withdrawalCredentials)
    : MAX_EFFECTIVE_BALANCE;

  // Check if at max effective balance and has excess balance
  const hasMaxEffectiveBalance = validator.effectiveBalance === maxEffectiveBalance;
  const hasExcessBalance = balance > maxEffectiveBalance;

  return hasMaxEffectiveBalance && hasExcessBalance;
}

export function getPendingBalanceToWithdraw(
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  validatorIndex: ValidatorIndex
): number {
  let total = 0;
  for (const item of state.pendingPartialWithdrawals.getAllReadonly()) {
    if (item.validatorIndex === validatorIndex) {
      total += Number(item.amount);
    }
  }

  return total;
}
