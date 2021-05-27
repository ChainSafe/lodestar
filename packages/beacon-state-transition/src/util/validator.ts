/**
 * @module chain/stateTransition/util
 */

import {hash, readonlyValues} from "@chainsafe/ssz";
import {
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Slot,
  Uint64,
  phase0,
  ValidatorIndex,
  allForks,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getCurrentEpoch} from "./epoch";
import {intDiv, bytesToInt} from "@chainsafe/lodestar-utils";
import {getBeaconCommittee} from "./committee";
import {EFFECTIVE_BALANCE_INCREMENT, TARGET_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";

export function computeCompactValidator(validator: phase0.Validator, index: ValidatorIndex): Uint64 {
  // `index` (top 6 bytes) + `slashed` (16th bit) + `compact_balance` (bottom 15 bits)
  const compactBalance = validator.effectiveBalance / EFFECTIVE_BALANCE_INCREMENT;
  const compactValidator =
    (BigInt(index) << BigInt(16)) + (BigInt(validator.slashed ? 1 : 0) << BigInt(15)) + compactBalance;
  return compactValidator;
}

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
