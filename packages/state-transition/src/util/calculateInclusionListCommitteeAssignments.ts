import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root, Slot, ValidatorIndex} from "@lodestar/types";
import {EpochShuffling} from "./epochShuffling.js";

export function calculateInclusionListCommitteeAssignments(
  epochShuffling: EpochShuffling,
  requestedValidatorIndices: ValidatorIndex[]
): Map<ValidatorIndex, {slot: Slot; committeeRoot: Root}> {
  const requestedValidatorIndicesSet = new Set(requestedValidatorIndices);
  const duties = new Map<ValidatorIndex, {slot: Slot; committeeRoot: Root}>();

  const epochCommittees = epochShuffling.inclusionListCommittees;
  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slotCommittee = epochCommittees[epochSlot];

    for (let i = 0; i < slotCommittee.length; i++) {
      const validatorIndex = slotCommittee[i];

      if (requestedValidatorIndicesSet.has(validatorIndex)) {
        duties.set(validatorIndex, {
          slot: epochShuffling.epoch * SLOTS_PER_EPOCH + epochSlot,
          committeeRoot: epochShuffling.inclusionListCommitteeRoots[epochSlot],
        });
      }
    }
  }

  return duties;
}
