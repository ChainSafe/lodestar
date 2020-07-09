import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {AttesterDuty, BeaconState, BLSPubkey, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {getCommitteeAssignment} from "@chainsafe/lodestar-beacon-state-transition";
import {intDiv} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";


export function assembleAttesterDuty(
  config: IBeaconConfig,
  validator: {publicKey: BLSPubkey; index: ValidatorIndex},
  state: TreeBacked<BeaconState>,
  epoch: Epoch
): AttesterDuty  {
  let duty: AttesterDuty = generateEmptyAttesterDuty(validator.publicKey);
  const committeeAssignment = getCommitteeAssignment(
    config,
    state,
    epoch,
    validator.index
  );
  console.log({committeeAssignment});
  if (committeeAssignment) {
    duty = {
      ...duty,
      aggregatorModulo: Math.max(
        1,
        intDiv(committeeAssignment.validators.length, config.params.TARGET_AGGREGATORS_PER_COMMITTEE)
      ),
      committeeIndex: committeeAssignment.committeeIndex,
      attestationSlot: committeeAssignment.slot,
    };
  }

  return duty;
}

export function generateEmptyAttesterDuty(publicKey: BLSPubkey, duty?: Partial<AttesterDuty>): AttesterDuty {
  return {
    validatorPubkey: publicKey,
    aggregatorModulo: 1,
    attestationSlot: null,
    committeeIndex: null,
    ...duty
  };
}
