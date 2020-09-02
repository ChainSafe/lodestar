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
  const duty: AttesterDuty = generateEmptyAttesterDuty(validator.publicKey);
  const committeeAssignment = epochCtx.getCommitteeAssignment(epoch, validator.index);
  if (committeeAssignment) {
    return {
      ...duty,
      aggregatorModulo: Math.max(
        1,
        intDiv(committeeAssignment.validators.length, config.params.TARGET_AGGREGATORS_PER_COMMITTEE)
      ),
      committeeIndex: committeeAssignment.committeeIndex,
      attestationSlot: committeeAssignment.slot,
    };
  }

  return null;
}

export function generateEmptyAttesterDuty(publicKey: BLSPubkey, duty?: Partial<AttesterDuty>): AttesterDuty {
  return {
    validatorPubkey: publicKey,
    aggregatorModulo: 1,
    attestationSlot: null!,
    committeeIndex: null!,
    ...duty,
  };
}
