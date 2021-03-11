/**
 * @module chain/stateTransition/util
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Epoch, phase0, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
import {getBeaconCommittee, getCommitteeCountAtSlot} from "./committee";
import {computeEpochAtSlot, computeStartSlotAtEpoch, getCurrentEpoch} from "./epoch";
import {getBeaconProposerIndex} from "./proposer";

/**
 * Return the committee assignment in the ``epoch`` for ``validator_index``.
 * ``assignment`` returned is a tuple of the following form:
 * ``assignment[0]`` is the list of validators in the committee
 * ``assignment[1]`` is the index to which the committee is assigned
 * ``assignment[2]`` is the slot at which the committee is assigned
 * Return null if no assignment..
 */
export function getCommitteeAssignment(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  epoch: Epoch,
  validatorIndex: ValidatorIndex
): phase0.CommitteeAssignment | null {
  const next2Epoch = getCurrentEpoch(config, state) + 2;
  assert.lte(epoch, next2Epoch, "Cannot get committee assignment for epoch more than two ahead");

  const epochStartSlot = computeStartSlotAtEpoch(config, epoch);
  for (let slot = epochStartSlot; slot < epochStartSlot + config.params.SLOTS_PER_EPOCH; slot++) {
    const committeeCount = getCommitteeCountAtSlot(config, state, slot);
    for (let i = 0; i < committeeCount; i++) {
      const committee = getBeaconCommittee(config, state, slot, i);
      if (committee.includes(validatorIndex)) {
        return {
          validators: committee as List<number>,
          committeeIndex: i,
          slot,
        };
      }
    }
  }

  return null;
}

/**
 * Checks if a validator is supposed to propose a block
 */
export function isProposerAtSlot(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  slot: Slot,
  validatorIndex: ValidatorIndex
): boolean {
  state = {...state, slot};
  const currentEpoch = getCurrentEpoch(config, state);
  assert.equal(computeEpochAtSlot(config, slot), currentEpoch, "Must request for current epoch");

  return getBeaconProposerIndex(config, state) === validatorIndex;
}
