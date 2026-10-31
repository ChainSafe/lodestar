import {ChainForkConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  GENESIS_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_ACTIVATION_BALANCE,
  SWEEP_THRESHOLD_CREDENTIAL_LENGTH,
  SWEEP_THRESHOLD_CREDENTIAL_OFFSET,
} from "@lodestar/params";
import {Epoch, ValidatorIndex, phase0} from "@lodestar/types";
import {intDiv} from "@lodestar/utils";
import {BeaconStateAllForks, CachedBeaconStateElectra, CachedBeaconStateGloas, EpochCache} from "../types.js";
import {hasEth1WithdrawalCredential} from "./capella.js";
import {hasCompoundingWithdrawalCredential, hasExecutionWithdrawalCredential} from "./electra.js";
import {getSlotDurationMsAtEpoch} from "./slot.js";

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

// Deneb fork upgrade only
export function getValidatorActivationChurnLimit(
  config: ChainForkConfig,
  fork: ForkSeq,
  activeValidatorCount: number
): number {
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

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.6/specs/gloas/beacon-chain.md#new-get_activation_churn_limit
 */
export function getActivationChurnLimit(epochCtx: EpochCache): number {
  const {config, epoch, totalActiveBalanceIncrements} = epochCtx;
  const churnByBalance = Math.floor(
    (totalActiveBalanceIncrements / config.CHURN_LIMIT_QUOTIENT_GLOAS) * EFFECTIVE_BALANCE_INCREMENT
  );
  const churn = Math.min(
    config.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT_GLOAS,
    Math.max(churnByBalance, config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA)
  );
  // Scale by the slot duration ratio, rounding to the increment once after scaling
  const scaled = Math.floor(
    (churn * getSlotDurationMsAtEpoch(config, epoch)) / getSlotDurationMsAtEpoch(config, GENESIS_EPOCH)
  );
  return scaled - (scaled % EFFECTIVE_BALANCE_INCREMENT);
}

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.6/specs/gloas/beacon-chain.md#new-get_exit_churn_limit
 */
export function getExitChurnLimit(epochCtx: EpochCache): number {
  const {config, epoch, totalActiveBalanceIncrements} = epochCtx;
  const churnByBalance = Math.floor(
    (totalActiveBalanceIncrements / config.CHURN_LIMIT_QUOTIENT_GLOAS) * EFFECTIVE_BALANCE_INCREMENT
  );
  const churn = Math.max(churnByBalance, config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA);
  // Scale by the slot duration ratio, rounding to the increment once after scaling
  const scaled = Math.floor(
    (churn * getSlotDurationMsAtEpoch(config, epoch)) / getSlotDurationMsAtEpoch(config, GENESIS_EPOCH)
  );
  return scaled - (scaled % EFFECTIVE_BALANCE_INCREMENT);
}

/**
 * Spec (electra): get_consolidation_churn_limit (uses combined balance churn minus activation+exit churn)
 * Spec (gloas): get_consolidation_churn_limit (independent quotient, no MIN floor)
 */
export function getConsolidationChurnLimit(fork: ForkSeq, epochCtx: EpochCache): number {
  if (fork >= ForkSeq.gloas) {
    const {config, epoch, totalActiveBalanceIncrements} = epochCtx;
    // No MIN floor in gloas
    const churn = Math.floor(
      (totalActiveBalanceIncrements / config.CONSOLIDATION_CHURN_LIMIT_QUOTIENT) * EFFECTIVE_BALANCE_INCREMENT
    );
    // Scale by the slot duration ratio, rounding to the increment once after scaling
    const scaled = Math.floor(
      (churn * getSlotDurationMsAtEpoch(config, epoch)) / getSlotDurationMsAtEpoch(config, GENESIS_EPOCH)
    );
    return scaled - (scaled % EFFECTIVE_BALANCE_INCREMENT);
  }
  return getBalanceChurnLimitFromCache(epochCtx) - getActivationExitChurnLimit(epochCtx);
}

// NOTE: duplicates the quotient/min choices in get{Exit,Activation,Consolidation}ChurnLimit.
export function getGloasChurnLimits(
  config: ChainForkConfig,
  epoch: Epoch,
  totalActiveBalanceIncrements: number
): {exit: number; activation: number; consolidation: number} {
  const ratioNumerator = getSlotDurationMsAtEpoch(config, epoch);
  const ratioDenominator = getSlotDurationMsAtEpoch(config, GENESIS_EPOCH);
  const exitUnscaled = Math.max(
    Math.floor((totalActiveBalanceIncrements / config.CHURN_LIMIT_QUOTIENT_GLOAS) * EFFECTIVE_BALANCE_INCREMENT),
    config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA
  );
  const activationUnscaled = Math.min(config.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT_GLOAS, exitUnscaled);
  const consolidationUnscaled = Math.floor(
    (totalActiveBalanceIncrements / config.CONSOLIDATION_CHURN_LIMIT_QUOTIENT) * EFFECTIVE_BALANCE_INCREMENT
  );
  const exit = Math.floor((exitUnscaled * ratioNumerator) / ratioDenominator);
  const activation = Math.floor((activationUnscaled * ratioNumerator) / ratioDenominator);
  const consolidation = Math.floor((consolidationUnscaled * ratioNumerator) / ratioDenominator);
  return {
    exit: exit - (exit % EFFECTIVE_BALANCE_INCREMENT),
    activation: activation - (activation % EFFECTIVE_BALANCE_INCREMENT),
    consolidation: consolidation - (consolidation % EFFECTIVE_BALANCE_INCREMENT),
  };
}

export function getMaxEffectiveBalance(withdrawalCredentials: Uint8Array): number {
  // Compounding withdrawal credential only available since Electra
  if (hasCompoundingWithdrawalCredential(withdrawalCredentials)) {
    return MAX_EFFECTIVE_BALANCE_ELECTRA;
  }
  return MIN_ACTIVATION_BALANCE;
}

/**
 * Sweep threshold increments stored in bytes 1..2 of compounding withdrawal credentials, 0 when unset.
 */
export function getSweepThresholdIncrements(withdrawalCredentials: Uint8Array): number {
  let increments = 0;
  for (let i = SWEEP_THRESHOLD_CREDENTIAL_LENGTH - 1; i >= 0; i--) {
    increments = increments * 256 + withdrawalCredentials[SWEEP_THRESHOLD_CREDENTIAL_OFFSET + i];
  }
  return increments;
}

/**
 * Spec: get_sweep_threshold, see consensus-specs PR 5790
 * https://github.com/ethereum/consensus-specs/pull/5790
 */
export function getSweepThreshold(withdrawalCredentials: Uint8Array): number {
  if (!hasCompoundingWithdrawalCredential(withdrawalCredentials)) {
    return getMaxEffectiveBalance(withdrawalCredentials);
  }

  const threshold = getSweepThresholdIncrements(withdrawalCredentials) * EFFECTIVE_BALANCE_INCREMENT;
  if (threshold < MIN_ACTIVATION_BALANCE || threshold > MAX_EFFECTIVE_BALANCE_ELECTRA) {
    return MAX_EFFECTIVE_BALANCE_ELECTRA;
  }
  return threshold;
}

/**
 * Spec: set_sweep_threshold, see consensus-specs PR 5790. Returns new credentials, the input is not mutated.
 * MAX_EFFECTIVE_BALANCE_ELECTRA is stored as 0 so every threshold has a single encoding.
 */
export function withSweepThreshold(withdrawalCredentials: Uint8Array, threshold: number): Uint8Array {
  const increments =
    threshold >= MIN_ACTIVATION_BALANCE && threshold < MAX_EFFECTIVE_BALANCE_ELECTRA
      ? Math.floor(threshold / EFFECTIVE_BALANCE_INCREMENT)
      : 0;
  const credentials = Uint8Array.prototype.slice.call(withdrawalCredentials);
  for (let i = 0; i < SWEEP_THRESHOLD_CREDENTIAL_LENGTH; i++) {
    credentials[SWEEP_THRESHOLD_CREDENTIAL_OFFSET + i] = Math.floor(increments / 256 ** i) % 256;
  }
  return credentials;
}

/**
 * Check if validator is partially withdrawable.
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/electra/beacon-chain.md#modified-is_partially_withdrawable_validator
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-beta.4/specs/_features/eip8148/beacon-chain.md#modified-is_partially_withdrawable_validator
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

  if (fork >= ForkSeq.heze) {
    const sweepThreshold = getSweepThreshold(validator.withdrawalCredentials);
    return validator.effectiveBalance >= sweepThreshold && balance > sweepThreshold;
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
