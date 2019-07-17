import {Attestation, Epoch} from "@chainsafe/eth2-types";
import {OperationsModule} from "./abstract";

export class AttestationOperations extends OperationsModule {

  /**
   * Process incoming attestation
   */
  public async receive(attestation: Attestation): Promise<void> {
    await this.db.setAttestation(attestation);
  }

  /**
   * Return all stored attestations
   */
  public async getAll(): Promise<Attestation[]> {
    return await this.db.getAttestations();
  }

  public async remove(epoch: Epoch): Promise<void> {
  }

}
