import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BLSPubkey, Epoch, ValidatorDuty, ValidatorIndex,BeaconState, Slot} from "@chainsafe/eth2.0-types";
import {getCommitteeAssignment} from "@chainsafe/eth2.0-state-transition";


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
