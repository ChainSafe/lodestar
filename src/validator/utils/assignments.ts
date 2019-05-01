import assert from "assert";

import {
  BeaconState, Epoch, Slot,
  ValidatorIndex,
} from "../../types";

import {
  SLOTS_PER_EPOCH,
} from "../../constants";

import {
  getBeaconProposerIndex, getCrosslinkCommitteesAtSlot,
  getCurrentEpoch,
  getPreviousEpoch,
  getEpochStartSlot,
  slotToEpoch,
} from "../../chain/stateTransition/util";

import {CommitteeAssignment} from "../types";


/**
 * Return the committee assignment in the ``epoch`` for ``validator_index`` and ``registry_change``.
 * ``assignment`` returned is a tuple of the following form:
 * ``assignment[0]`` is the list of validators in the committee
 * ``assignment[1]`` is the shard to which the committee is assigned
 * ``assignment[2]`` is the slot at which the committee is assigned
 * a beacon block at the assigned slot.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @param {ValidatorIndex} validatorIndex
 * @param {boolean} registryChange
 * @returns {{validators: ValidatorIndex[]; shard: Shard; slot: number; isProposer: boolean}}
 */
export function getCommitteeAssignment(
  state: BeaconState,
  epoch: Epoch,
  validatorIndex: ValidatorIndex): CommitteeAssignment {

  const previousEpoch = getPreviousEpoch(state);
  const nextEpoch = getCurrentEpoch(state) + 1;
  assert(previousEpoch <= epoch && epoch <= nextEpoch);

  const epochStartSlot = getEpochStartSlot(epoch);
  const loopEnd = epochStartSlot + SLOTS_PER_EPOCH;

  for (let slot = epochStartSlot; slot < loopEnd; slot++) {
    const crosslinkCommittees = getCrosslinkCommitteesAtSlot(state, slot);
    const selectedCommittees = crosslinkCommittees.map((committee) => committee[0].includes(validatorIndex));

    if (selectedCommittees.length > 0) {
      const validators = selectedCommittees[0][0];
      const shard = selectedCommittees[0][1];
      return {validators, shard, slot};
    }
  }
}

/**
 * Checks if a validator is supposed to propose a block
 * @param {BeaconState} state
 * @param {Slot} slot
 * @param {ValidatorIndex} validatorIndex
 * @returns {Boolean}
 */
export function isProposerAtSlot(
  state: BeaconState,
  slot: Slot,
  validatorIndex: ValidatorIndex): boolean {

  const currentEpoch = getCurrentEpoch(state);
  assert(slotToEpoch(slot) === currentEpoch);

  return getBeaconProposerIndex(state) === validatorIndex;
}
