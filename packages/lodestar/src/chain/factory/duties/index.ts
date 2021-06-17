import {routes} from "@chainsafe/lodestar-api";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {BLSPubkey, Epoch, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";

export function assembleAttesterDuty(
  validator: {pubkey: BLSPubkey; index: ValidatorIndex},
  epochCtx: allForks.EpochContext,
  epoch: Epoch
): routes.validator.AttesterDuty | null {
  const committeeAssignment = epochCtx.getCommitteeAssignment(epoch, validator.index);
  if (committeeAssignment) {
    let validatorCommitteeIndex = -1;
    let index = 0;
    for (const i of readonlyValues(committeeAssignment.validators)) {
      if (ssz.ValidatorIndex.equals(i, validator.index)) {
        validatorCommitteeIndex = index;
        break;
      }
      index++;
    }
    return {
      pubkey: validator.pubkey,
      validatorIndex: validator.index,
      committeeLength: committeeAssignment.validators.length,
      committeesAtSlot: epochCtx.getCommitteeCountAtSlot(committeeAssignment.slot),
      validatorCommitteeIndex,
      committeeIndex: committeeAssignment.committeeIndex,
      slot: committeeAssignment.slot,
    };
  }

  return null;
}
