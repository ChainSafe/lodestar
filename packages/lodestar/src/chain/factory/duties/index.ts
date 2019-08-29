import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState, BLSPubkey, ValidatorDuty, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {computeEpochOfSlot, getCommitteeAssignment} from "../../stateTransition/util";

export function assembleValidatorDuty(
  config: IBeaconConfig,
  validatorPublicKey: BLSPubkey,
  validatorIndex: ValidatorIndex,
  state: BeaconState,
  blockProposerIndex: ValidatorIndex): ValidatorDuty  {
  let duty: Partial<ValidatorDuty> = generateEmptyValidatorDuty(validatorPublicKey);
  const committeeAsignment = getCommitteeAssignment(
    config,
    state,
    computeEpochOfSlot(config, state.slot),
    validatorIndex
  );
  if (committeeAsignment) {
    duty = {
      ...duty,
      attestationShard: committeeAsignment.shard,
      attestationSlot: committeeAsignment.slot,
      committeeIndex: committeeAsignment.validators.indexOf(validatorIndex)
    };
  }
  if (validatorIndex === blockProposerIndex) {
    duty = {
      ...duty,
      blockProductionSlot: state.slot
    };
  }
  return duty as ValidatorDuty;
}

export function generateEmptyValidatorDuty(publicKey: BLSPubkey): Partial<ValidatorDuty> {
  return {
    validatorPubkey: publicKey
  };
}
