import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {CommitteeIndex, Slot, ValidatorIndex} from "@lodestar/types";
import {EpochShuffling} from "./epochShuffling.js";

// Copied from lodestar-api package to avoid depending on the package
export interface InclusionListDuty {
  validatorIndex: ValidatorIndex;
  slot: Slot;
}

export function calculateInclusionListCommitteeAssignments(
  epochShuffling: EpochShuffling,
  requestedValidatorIndices: ValidatorIndex[]
): Map<ValidatorIndex, InclusionListDuty> {
  const requestedValidatorIndicesSet = new Set(requestedValidatorIndices);
  const duties = new Map<ValidatorIndex, InclusionListDuty>();

  const epochCommittees = epochShuffling.inclusionListCommittees;
  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slotCommittee = epochCommittees[epochSlot];

    for (let i = 0; i < slotCommittee.length; i++) {
      const validatorIndex = slotCommittee[i];

      if (requestedValidatorIndicesSet.has(validatorIndex)) {
        duties.set(validatorIndex, {
          validatorIndex,
          slot: epochShuffling.epoch * SLOTS_PER_EPOCH + epochSlot,
        });
      }
    }
  }

  return duties;
}
