import {routes} from "@chainsafe/lodestar-api";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {BLSPubkey, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";

export function assembleAttesterDuties(
  validators: {pubkey: BLSPubkey; index: ValidatorIndex}[],
  epochCtx: allForks.EpochContext,
  epoch: Epoch
): routes.validator.AttesterDuty[] {
  return validators
    .map((validator) => {
      const committeeAssignment = epochCtx.getCommitteeAssignment(epoch, validator.index);
      if (committeeAssignment) {
        return {
          pubkey: validator.pubkey,
          validatorIndex: validator.index,
          committeeLength: committeeAssignment.validators.length,
          committeesAtSlot: epochCtx.getCommitteeCountAtSlot(committeeAssignment.slot),
          validatorCommitteeIndex: validator.index,
          committeeIndex: committeeAssignment.committeeIndex,
          slot: committeeAssignment.slot,
        };
      }
      return null;
    })
    .filter((v) => v !== null) as routes.validator.AttesterDuty[];
}
