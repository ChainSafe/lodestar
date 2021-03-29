import {readonlyValues} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSPubkey, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";

export function assembleAttesterDuty(
  config: IBeaconConfig,
  validator: {pubkey: BLSPubkey; index: ValidatorIndex},
  epochCtx: phase0.fast.EpochContext,
  epoch: Epoch
): phase0.AttesterDuty | null {
  const committeeAssignment = epochCtx.getCommitteeAssignment(epoch, validator.index);
  if (committeeAssignment) {
    let validatorCommitteeIndex = -1;
    let index = 0;
    for (const i of readonlyValues(committeeAssignment.validators)) {
      if (config.types.ValidatorIndex.equals(i, validator.index)) {
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
