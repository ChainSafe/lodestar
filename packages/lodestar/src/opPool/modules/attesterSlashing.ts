import {OperationsModule} from "./abstract";
import {AttesterSlashing, ValidatorIndex} from "@chainsafe/lodestar-types";

export class AttesterSlashingOperations extends OperationsModule<AttesterSlashing> {

  public async hasAll(attesterIndices: ValidatorIndex[] = []): Promise<boolean> {
    const attesterSlashings = await this.getAll() || [];
    const indices = new Set<ValidatorIndex>();
    for (const slashing of attesterSlashings) {
      slashing.attestation1.attestingIndices.forEach(index => indices.add(index));
      slashing.attestation2.attestingIndices.forEach(index => indices.add(index));
    }
    for (const attesterIndice of attesterIndices) {
      if (!indices.has(attesterIndice)) {
        return false;
      }
    }
    // has all attesterIndices
    return true;
  }
}
