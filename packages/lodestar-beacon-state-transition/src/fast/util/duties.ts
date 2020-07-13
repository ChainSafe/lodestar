import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CommitteeAssignment, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {EpochContext} from "./epochContext";
import {computeStartSlotAtEpoch} from "../../util";
import {assert} from "@chainsafe/lodestar-utils";

/**
 * Return the committee assignment in the ``epoch`` for ``validator_index``.
 * ``assignment`` returned is a tuple of the following form:
 * ``assignment[0]`` is the list of validators in the committee
 * ``assignment[1]`` is the index to which the committee is assigned
 * ``assignment[2]`` is the slot at which the committee is assigned
 * Return null if no assignment..
 */
export function getFastCommitteeAssignment(
  config: IBeaconConfig,
  epochCtx: EpochContext,
  epoch: Epoch,
  validatorIndex: ValidatorIndex
): CommitteeAssignment {

  const nextEpoch = epochCtx.currentShuffling.epoch + 1;
  assert.lte(epoch, nextEpoch, "Cannot get committee assignment for epoch more than 1 ahead");

  const epochStartSlot = computeStartSlotAtEpoch(config, epoch);
  for (let slot = epochStartSlot; slot < epochStartSlot + config.params.SLOTS_PER_EPOCH; slot++) {
    const committeeCount = epochCtx.getCommitteeCountAtSlot(slot);
    for (let i = 0; i < committeeCount; i++) {
      const committee = epochCtx.getBeaconCommittee(slot, i);
      if (committee.includes(validatorIndex)) {
        return {
          validators: committee,
          committeeIndex: i,
          slot,
        };
      }
    }
  }

  return null;
}
