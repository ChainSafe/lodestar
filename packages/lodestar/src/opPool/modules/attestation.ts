import {Attestation, Slot, BeaconState} from "@chainsafe/eth2.0-types";

import {OperationsModule} from "./abstract";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {getAttestationDataSlot, isValidAttestationSlot} from "../../chain/stateTransition/util";

export class AttestationOperations extends OperationsModule<Attestation> {

  public async getValid(state: BeaconState, config: IBeaconConfig): Promise<Attestation[]> {
    const attestations: Attestation[] = await this.getAll();
    return attestations.filter((a: Attestation) => {
      const attestationSlot: Slot = getAttestationDataSlot(config, state, a.data);
      return isValidAttestationSlot(config, attestationSlot, state.slot);
    });
  }

  public async pruneInvalid(state: BeaconState, config: IBeaconConfig): Promise<void> {
    const attestations: Attestation[] = await this.getAll();
    const invalidAttestations: Attestation[] = attestations.filter((a: Attestation) => {
      const attestationSlot: Slot = getAttestationDataSlot(config, state, a.data);
      return state.slot >= attestationSlot + config.params.SLOTS_PER_EPOCH;
    });
    await this.db.deleteManyByValue(invalidAttestations);
  }
}
