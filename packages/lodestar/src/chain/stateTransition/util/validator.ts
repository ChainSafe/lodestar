/**
 * @module chain/stateTransition/util
 */

import assert from "assert";
import {BeaconState, Epoch, Slot, Validator, ValidatorIndex,} from "../../../types";
import {IBeaconConfig} from "../../../config";
import {
  getBeaconProposerIndex,
  getCrosslinkCommittee,
  getEpochCommitteeCount,
  getEpochStartShard,
  slotToEpoch
} from "./index";
import {CommitteeAssignment} from "../../../validator/types";
import {getCurrentEpoch, getEpochStartSlot} from "./epoch";
import {intDiv} from "../../../util/math";


/**
 * Check if validator is active
 */
export function isActiveValidator(validator: Validator, epoch: Epoch): boolean {
  return validator.activationEpoch <= epoch && epoch < validator.exitEpoch;
}

/**
 * Check if validator is slashable
 */
export function isSlashableValidator(validator: Validator, epoch: Epoch): boolean {
  return (
    !validator.slashed &&
    validator.activationEpoch <= epoch &&
    epoch < validator.withdrawableEpoch
  );
}

/**
 * Get indices of active validators from validators.
 */
export function getActiveValidatorIndices(state: BeaconState, epoch: Epoch): ValidatorIndex[] {
  return state.validatorRegistry.reduce((indices, validator, index) => {
    if (isActiveValidator(validator, epoch)) {
      indices.push(index);
    }
    return indices;
  }, []);
}

/**
 * Return the committee assignment in the ``epoch`` for ``validator_index`` and ``registry_change``.
 * ``assignment`` returned is a tuple of the following form:
 * ``assignment[0]`` is the list of validators in the committee
 * ``assignment[1]`` is the shard to which the committee is assigned
 * ``assignment[2]`` is the slot at which the committee is assigned
 * a beacon block at the assigned slot.
 */
export function getCommitteeAssignment(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch,
  validatorIndex: ValidatorIndex
): CommitteeAssignment {

  const nextEpoch = getCurrentEpoch(config, state) + 1;
  assert(epoch <= nextEpoch);

  const committeesPerSlot = intDiv(getEpochCommitteeCount(config, state, epoch), config.params.SLOTS_PER_EPOCH);
  const epochStartSlot = getEpochStartSlot(config, epoch);
  for (let slot = epochStartSlot; slot < epochStartSlot + config.params.SLOTS_PER_EPOCH; slot++) {
    const slotStartShard =
      getEpochStartShard(config, state, epoch) + committeesPerSlot * (slot % config.params.SLOTS_PER_EPOCH);
    for (let i = 0; i < committeesPerSlot; i++) {
      const shard = (slotStartShard + i) % config.params.SHARD_COUNT;
      const committee = getCrosslinkCommittee(config, state, epoch, shard);
      if (committee.includes(validatorIndex)) {
        return {
          validators: committee,
          shard,
          slot,
        };
      }
    }
  }
}

/**
 * Checks if a validator is supposed to propose a block
 */
export function isProposerAtSlot(
  config: IBeaconConfig,
  state: BeaconState,
  slot: Slot,
  validatorIndex: ValidatorIndex): boolean {

  state = {...state, slot};
  const currentEpoch = getCurrentEpoch(config, state);
  assert(slotToEpoch(config, slot) === currentEpoch);

  return getBeaconProposerIndex(config, state) === validatorIndex;
}
