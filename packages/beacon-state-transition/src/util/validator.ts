/**
 * @module chain/stateTransition/util
 */

import {hash, readonlyValues} from "@chainsafe/ssz";
import {BLSSignature, CommitteeIndex, Epoch, Slot, phase0, ValidatorIndex, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getCurrentEpoch} from "./epoch";
import {intDiv, bytesToInt} from "@chainsafe/lodestar-utils";
import {getBeaconCommittee} from "./committee";
import {TARGET_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";

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

export function getChurnLimit(config: IBeaconConfig, activeValidatorCount: number): number {
  return Math.max(config.MIN_PER_EPOCH_CHURN_LIMIT, intDiv(activeValidatorCount, config.CHURN_LIMIT_QUOTIENT));
}

/**
 * Return the validator churn limit for the current epoch.
 */
export function getValidatorChurnLimit(config: IBeaconConfig, state: allForks.BeaconState): number {
  return getChurnLimit(config, getActiveValidatorIndices(state, getCurrentEpoch(state)).length);
}

export function isAggregator(
  state: allForks.BeaconState,
  slot: Slot,
  index: CommitteeIndex,
  slotSignature: BLSSignature
): boolean {
  const committee = getBeaconCommittee(state, slot, index);
  return isAggregatorFromCommitteeLength(committee.length, slotSignature);
}

export function isAggregatorFromCommitteeLength(committeeLength: number, slotSignature: BLSSignature): boolean {
  const modulo = Math.max(1, intDiv(committeeLength, TARGET_COMMITTEE_SIZE));
  return bytesToInt(hash(slotSignature.valueOf() as Uint8Array).slice(0, 8)) % modulo === 0;
}
