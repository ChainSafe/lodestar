import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {AttesterDuty, BLSPubkey, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";

export function assembleAttesterDuty(
  validator: {pubkey: BLSPubkey; index: ValidatorIndex},
  state: CachedBeaconState,
  epoch: Epoch
): AttesterDuty | null {
  const committeeAssignment = state.getCommitteeAssignment(epoch, validator.index);
  if (committeeAssignment) {
    return {
      pubkey: validator.pubkey,
      validatorIndex: validator.index,
      committeeLength: committeeAssignment.validators.length,
      committeesAtSlot: state.getCommitteeCountAtSlot(committeeAssignment.slot),
      validatorCommitteeIndex: committeeAssignment.validators.findIndex((i) =>
        state.config.types.ValidatorIndex.equals(i, validator.index)
      ),
      committeeIndex: committeeAssignment.committeeIndex,
      slot: committeeAssignment.slot,
    };
  }

  return null;
}
