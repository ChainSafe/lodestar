import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

/**
 * AttesterSlashing indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttesterSlashingRepository extends Repository<Uint8Array, phase0.AttesterSlashing> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_attesterSlashing, config.types.phase0.AttesterSlashing);
  }

  public async hasAll(attesterIndices: ValidatorIndex[] = []): Promise<boolean> {
    const attesterSlashings = (await this.values()) || [];
    const indices = new Set<ValidatorIndex>();
    for (const slashing of attesterSlashings) {
      for (const index of slashing.attestation1.attestingIndices) indices.add(index);
      for (const index of slashing.attestation2.attestingIndices) indices.add(index);
    }
    for (const attesterIndice of attesterIndices) {
      if (!indices.has(attesterIndice)) {
        return false;
      }
    }
    return true;
  }
}
