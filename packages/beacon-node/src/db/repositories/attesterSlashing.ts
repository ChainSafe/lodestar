import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {AttesterSlashing, ValidatorIndex, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * AttesterSlashing indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttesterSlashingRepository extends Repository<Uint8Array, AttesterSlashing> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_attesterSlashing;
    /**
     * We are using `ssz.electra.AttesterSlashing` type since it is backward compatible with `ssz.phase0.AttesterSlashing`
     * But this also means the length of `attestingIndices` is not checked/enforced here. Need to make sure length
     * is correct before writing to db.
     */
    const type = ssz.electra.AttesterSlashing;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
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
