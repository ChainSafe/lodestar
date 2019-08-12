import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BLSPubkey, ValidatorDuty, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {getCommitteeAssignment, computeEpochOfSlot} from "../../stateTransition/util";

export function assembleValidatorDuty(
  config: IBeaconConfig,
  validatorPublicKey: BLSPubkey,
  validatorIndex: ValidatorIndex,
  state,
  blockProposerIndex: ValidatorIndex): ValidatorDuty  {
  let duty: ValidatorDuty = this.generateEmptyValidatorDuty(validatorPublicKey);
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
  return duty;
}

export function generateEmptyValidatorDuty(publicKey: BLSPubkey): ValidatorDuty {
  return {
    validatorPubkey: publicKey,
    blockProductionSlot: null,
    attestationShard: null,
    attestationSlot: null,
    committeeIndex: null
  };
}
