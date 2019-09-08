import {Attestation, Slot, BeaconState} from "@chainsafe/eth2.0-types";

import {OperationsModule} from "./abstract";
import {AttestationRepository} from "../../db/api/beacon/repositories";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {getAttestationDataSlot} from "../../chain/stateTransition/util";

export class AttestationOperations extends OperationsModule<Attestation> {

  public async getValid(state: BeaconState, config: IBeaconConfig): Promise<Attestation[]> {
    const attestations: Attestation[] = await this.getAll();
    return attestations.filter((a: Attestation) => {
      const attestationSlot: Slot = getAttestationDataSlot(config, state, a.data);
      return (attestationSlot + config.params.MIN_ATTESTATION_INCLUSION_DELAY <= state.slot &&
          state.slot <= attestationSlot + config.params.SLOTS_PER_EPOCH);
    });
  }
}
