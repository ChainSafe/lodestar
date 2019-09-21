import {Attestation, Slot, BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {OperationsModule} from "./abstract";
import {getAttestationDataSlot, isValidAttestationSlot, computeStartSlotOfEpoch} from "../../chain/stateTransition/util";
import {BulkRepository} from "../../db/api/beacon/repository";

export class AttestationOperations extends OperationsModule<Attestation> {
  private readonly config: IBeaconConfig;

  public constructor(db: BulkRepository<Attestation>, {config}: {config: IBeaconConfig}) {
    super(db);
    this.config = config;
  }

  public async getValid(state: BeaconState): Promise<Attestation[]> {
    const attestations: Attestation[] = await this.getAll();
    return attestations.filter((a: Attestation) => {
      const attestationSlot: Slot = getAttestationDataSlot(this.config, state, a.data);
      return isValidAttestationSlot(this.config, attestationSlot, state.slot);
    });
  }

  public async removeOld(state: BeaconState): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotOfEpoch(this.config, state.finalizedCheckpoint.epoch);
    const attestations: Attestation[] = await this.getAll();
    await this.remove(attestations.filter((a) => {
      const aSlot = getAttestationDataSlot(this.config, state, a.data);
      return finalizedEpochStartSlot <= aSlot;
    }));
  }
}
