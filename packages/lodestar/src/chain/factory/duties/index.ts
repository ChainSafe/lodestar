import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BLSPubkey, Epoch, ValidatorDuty, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {getCommitteeAssignment, computeEpochOfSlot} from "../../stateTransition/util";

export function assembleValidatorDuty(
  config: IBeaconConfig,
  validatorPublicKey: BLSPubkey,
  validatorIndex: ValidatorIndex,
  state,
  epoch: Epoch,
  blockProposerIndex: ValidatorIndex): ValidatorDuty  {
  let duty: ValidatorDuty = this.generateEmptyValidatorDuty(validatorPublicKey);
  const committeeAsignment = getCommitteeAssignment(
    config,
    state,
    epoch,
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
  return duty;
}

export function generateEmptyValidatorDuty(publicKey: BLSPubkey, duty?: Partial<ValidatorDuty>): ValidatorDuty {
  return {
    validatorPubkey: publicKey,
    blockProductionSlot: duty.blockProductionSlot || null,
    attestationShard: duty.attestationShard || null,
    attestationSlot: duty.attestationSlot || null,
    committeeIndex: duty.committeeIndex || null
  };
}
