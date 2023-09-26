import {Epoch, phase0, ValidatorIndex} from "@lodestar/types";
import {intDiv} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {BeaconStateAllForks} from "../types.js";

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
    return Math.min(config.MAX_PER_EPOCH_CHURN_LIMIT, getChurnLimit(config, activeValidatorCount));
  } else {
    return getChurnLimit(config, activeValidatorCount);
  }
}

export function getChurnLimit(config: ChainForkConfig, activeValidatorCount: number): number {
  return Math.max(config.MIN_PER_EPOCH_CHURN_LIMIT, intDiv(activeValidatorCount, config.CHURN_LIMIT_QUOTIENT));
}
