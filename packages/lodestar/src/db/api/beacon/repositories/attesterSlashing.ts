import {AttesterSlashing, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

/**
 * AttesterSlashing indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttesterSlashingRepository extends Repository<Uint8Array, AttesterSlashing> {
  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.attesterSlashing, config.types.AttesterSlashing);
  }

  public async hasAll(attesterIndices: ValidatorIndex[] = []): Promise<boolean> {
    const attesterSlashings = await this.values() || [];
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
    return true;
  }
}
