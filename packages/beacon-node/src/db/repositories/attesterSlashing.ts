import {phase0, ssz, ValidatorIndex} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Bucket, Repository} from "@lodestar/db";

/**
 * AttesterSlashing indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttesterSlashingRepository extends Repository<Uint8Array, phase0.AttesterSlashing> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.phase0_attesterSlashing, ssz.phase0.AttesterSlashing);
  }

  async hasAll(attesterIndices: ValidatorIndex[] = []): Promise<boolean> {
    const attesterSlashings = (await this.values()) ?? [];
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
