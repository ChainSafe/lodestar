import {routes} from "@chainsafe/lodestar-api";
import {readonlyValues} from "@chainsafe/ssz";
import {allForks, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSPubkey, Epoch, ValidatorIndex, ssz} from "@chainsafe/lodestar-types";

export function assembleAttesterDuty(
  config: IBeaconConfig,
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
      committeesAtSlot: epochCtx.getCommitteeCountPerSlot(computeEpochAtSlot(committeeAssignment.slot)),
      validatorCommitteeIndex,
      committeeIndex: committeeAssignment.committeeIndex,
      slot: committeeAssignment.slot,
    };
  }

  return null;
}
