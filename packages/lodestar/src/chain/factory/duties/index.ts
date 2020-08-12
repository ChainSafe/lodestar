import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {AttesterDuty, BLSPubkey, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {intDiv} from "@chainsafe/lodestar-utils";


export function assembleAttesterDuty(
  config: IBeaconConfig,
  validator: {publicKey: BLSPubkey; index: ValidatorIndex},
  epochCtx: EpochContext,
  epoch: Epoch
): AttesterDuty | null {
  const committeeAssignment = epochCtx.getCommitteeAssignment(epoch, validator.index);
  if (!committeeAssignment) {
    return null;
  }
  return {
    validatorPubkey: validator.publicKey,
    aggregatorModulo: Math.max(
      1,
      intDiv(committeeAssignment.validators.length, config.params.TARGET_AGGREGATORS_PER_COMMITTEE)
    ),
    committeeIndex: committeeAssignment.committeeIndex,
    attestationSlot: committeeAssignment.slot,
  };
}
