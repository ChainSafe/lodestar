import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, BLSPubkey, Epoch, ValidatorDuty, ValidatorIndex} from "@chainsafe/lodestar-types";
import {getCommitteeAssignment} from "@chainsafe/lodestar-beacon-state-transition";


export function assembleValidatorDuty(
  config: IBeaconConfig,
  validator: {publicKey: BLSPubkey; index: ValidatorIndex},
  state: BeaconState,
  epoch: Epoch
): ValidatorDuty  {
  let duty: ValidatorDuty = generateEmptyValidatorDuty(validator.publicKey);
  const committeeAssignment = getCommitteeAssignment(
    config,
    state,
    epoch,
    validator.index
  );
  if (committeeAssignment) {
    duty = {
      ...duty,
      committeeIndex: committeeAssignment.committeeIndex,
      attestationSlot: committeeAssignment.slot,
    };
  }

  return duty;
}

export function generateEmptyValidatorDuty(publicKey: BLSPubkey, duty?: Partial<ValidatorDuty>): ValidatorDuty {
  return {
    validatorPubkey: publicKey,
    attestationSlot: null,
    committeeIndex: null,
    ...duty
  };
}
