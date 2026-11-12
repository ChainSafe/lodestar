import {BeaconStateView} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";

export class TestBeaconStateView extends BeaconStateView {
  setValidator(index: number, validator: phase0.Validator): void {
    if (index >= super.validatorCount) {
      throw new Error(`Validator index ${index} out of bounds`);
    }

    this.cachedState.validators.set(index, ssz.phase0.Validator.toViewDU(validator));
  }
}
