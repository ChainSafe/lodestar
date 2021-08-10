/**
 * @module chain/stateTransition/util
 */

import {readonlyValues} from "@chainsafe/ssz";
import {Epoch, phase0, ValidatorIndex, allForks} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";

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
export function getActiveValidatorIndices(state: allForks.BeaconState, epoch: Epoch): ValidatorIndex[] {
  const indices: ValidatorIndex[] = [];
  let index = 0;
  for (const validator of readonlyValues(state.validators)) {
    if (isActiveValidator(validator, epoch)) {
      indices.push(index);
    }
    index++;
  }
  return indices;
}

export function getChurnLimit(config: IChainForkConfig, activeValidatorCount: number): number {
  return Math.max(config.MIN_PER_EPOCH_CHURN_LIMIT, intDiv(activeValidatorCount, config.CHURN_LIMIT_QUOTIENT));
}
