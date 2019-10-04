import {Attestation, BeaconState, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {OperationsModule} from "./abstract";
import {
  aggregateAttestation,
  computeStartSlotOfEpoch,
  getAttestationDataSlot,
  isValidAttestationSlot,
} from "../../chain/stateTransition/util";
import {AttestationRepository} from "../../db/api/beacon/repositories";
import {clone, hashTreeRoot} from "@chainsafe/ssz";
import {processAttestation} from "../../chain/stateTransition/block/operations";

export class AttestationOperations extends OperationsModule<Attestation> {
  private readonly config: IBeaconConfig;

  public constructor(db: AttestationRepository, {config}: {config: IBeaconConfig}) {
    super(db);
    this.config = config;
  }

  public async receive(value: Attestation): Promise<void> {
    const existingAttestation = await this.db.get(hashTreeRoot(value.data, this.config.types.AttestationData));
    if(existingAttestation) {
      value = aggregateAttestation(this.config, existingAttestation, value);
    }
    return super.receive(value);
  }

  public async getValid(state: BeaconState): Promise<Attestation[]> {
    const attestations: Attestation[] = await this.getAll();
    return attestations.filter((a: Attestation) => {
      try {
        processAttestation(this.config, clone(state, this.config.types.BeaconState), a);
        return true;
      } catch (e) {
        return false;
      }
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
