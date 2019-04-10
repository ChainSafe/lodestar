import assert from "assert";

import {BeaconState, Epoch, ValidatorIndex, Shard} from "../src/types";
import {getPreviousEpoch, getCurrentEpoch, getEpochStartSlot, getCrosslinkCommitteesAtSlot, getBeaconProposerIndex} from "../src/chain/helpers/stateTransitionHelpers";
import {SLOTS_PER_EPOCH} from "../src/constants";

/**
 * Return the committee assignment in the ``epoch`` for ``validator_index`` and ``registry_change``.
 * ``assignment`` returned is a tuple of the following form:
 * ``assignment[0]`` is the list of validators in the committee
 * ``assignment[1]`` is the shard to which the committee is assigned
 * ``assignment[2]`` is the slot at which the committee is assigned
 * ``assignment[3]`` is a bool signalling if the validator is expected to propose
 * a beacon block at the assigned slot.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @param {ValidatorIndex} validatorIndex
 * @param {boolean} registryChange
 * @returns {{validators: ValidatorIndex[]; shard: Shard; slot: number; isProposer: boolean}}
 */
// TODO: Fix small bugs
export function getCommitteeAssignment(
  state: BeaconState,
  epoch: Epoch,
  validatorIndex: ValidatorIndex): {validators: ValidatorIndex[]; shard: Shard; slot: number; isProposer: boolean} {

  const previousEpoch = getPreviousEpoch(state);
  const nextEpoch = getCurrentEpoch(state) + 1;
  assert(previousEpoch <= epoch && epoch <= nextEpoch);

  const epochStartSlot = getEpochStartSlot(epoch);
  const loopEnd = epochStartSlot + SLOTS_PER_EPOCH;

  for (let slot = epochStartSlot; slot < loopEnd; slot++) {
    const crosslinkCommittees = getCrosslinkCommitteesAtSlot(state, slot);
    const selectedCommittees = crosslinkCommittees.map((x) => {
      if (x[0].contains(validatorIndex)) {
        return x;
      }
    });
    if (selectedCommittees.length > 0) {
      const validators = selectedCommittees[0][0];
      const shard = selectedCommittees[0][1];
      const isProposer = validatorIndex === getBeaconProposerIndex(state, slot);
      return {validators, shard, slot, isProposer}
    }
  }
}
