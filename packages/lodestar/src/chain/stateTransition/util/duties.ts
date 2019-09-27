/**
 * @module chain/stateTransition/util
 */

import assert from "assert";
import {
  BeaconState,
  Epoch,
  Slot,
  ValidatorIndex,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {CommitteeAssignment} from "../../../validator/types";

import {
  computeEpochOfSlot,
  computeStartSlotOfEpoch,
  getCurrentEpoch,
} from "./epoch";
import {getCommitteeCount, getStartShard, getCrosslinkCommittee} from "./committee";
import {getBeaconProposerIndex} from "./proposer";
import {intDiv} from "@chainsafe/eth2.0-utils";

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
  // @ts-ignore
): CommitteeAssignment {

  const nextEpoch = getCurrentEpoch(config, state) + 1;
  assert(epoch <= nextEpoch);

  const committeesPerSlot = intDiv(getCommitteeCount(config, state, epoch), config.params.SLOTS_PER_EPOCH);
  const epochStartSlot = computeStartSlotOfEpoch(config, epoch);
  for (let slot = epochStartSlot; slot < epochStartSlot + config.params.SLOTS_PER_EPOCH; slot++) {
    const offset = committeesPerSlot * (slot % config.params.SLOTS_PER_EPOCH);
    const slotStartShard = (getStartShard(config, state, epoch) + offset) % config.params.SHARD_COUNT;
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
  return null;
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
  assert(computeEpochOfSlot(config, slot) === currentEpoch);

  return getBeaconProposerIndex(config, state) === validatorIndex;
}
