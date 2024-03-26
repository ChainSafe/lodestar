import {Epoch, phase0, ValidatorIndex} from "@lodestar/types";
import {intDiv} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {EFFECTIVE_BALANCE_INCREMENT, ForkSeq} from "@lodestar/params";
import {BeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";

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
export function getActiveValidatorIndices(state: BeaconStateAllForks, epoch: Epoch): ValidatorIndex[] {
  const indices: ValidatorIndex[] = [];

  const validatorsArr = state.validators.getAllReadonlyValues();
  for (let i = 0; i < validatorsArr.length; i++) {
    if (isActiveValidator(validatorsArr[i], epoch)) {
      indices.push(i);
    }
  }

  return indices;
}

export function getActivationChurnLimit(config: ChainForkConfig, fork: ForkSeq, activeValidatorCount: number): number {
  if (fork >= ForkSeq.deneb) {
    return Math.min(config.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT, getChurnLimit(config, activeValidatorCount));
  } else {
    return getChurnLimit(config, activeValidatorCount);
  }
}

export function getActivationExitChurnLimit(state: CachedBeaconStateElectra): number {
  return Math.min(state.config.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT, getActivationExitConsolidationChurnLimit(state));
}

export function getConsolidationChurnLimit(state: CachedBeaconStateElectra): number {
  return getActivationExitConsolidationChurnLimit(state) - getActivationExitChurnLimit(state);
}

export function getActivationExitConsolidationChurnLimit(state: CachedBeaconStateElectra): number {
  const churnLimitByTotalActiveBalance = Math.floor((state.epochCtx.totalActiveBalanceIncrements / state.config.CHURN_LIMIT_QUOTIENT) * EFFECTIVE_BALANCE_INCREMENT); // TODO Electra: verify calculation

  const churn = Math.max(churnLimitByTotalActiveBalance, state.config.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT_ELECTRA);

  return churn - churn % EFFECTIVE_BALANCE_INCREMENT;
}
 
export function getChurnLimit(config: ChainForkConfig, activeValidatorCount: number): number {
  return Math.max(config.MIN_PER_EPOCH_CHURN_LIMIT, intDiv(activeValidatorCount, config.CHURN_LIMIT_QUOTIENT));
}
