import {Hash} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BulkRepository, Id, Repository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

/**
 * Holds hash(attestation.data) => hash(attestation)[] mapping
 */
export class AttestationDataRepository extends Repository<Hash[]> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(
      config,
      db,
      Bucket.attestationData,
      {
        elementType: config.types.Hash,
        maxLength: config.params.MAX_VALIDATORS_PER_COMMITTEE
      }
    );
  }

  public async addAttestation(id: Id, attestationHash: Hash): Promise<void> {
    const attestationHashes = await this.get(id);
    if(!attestationHashes) {
      await this.set(id, [attestationHash]);
    } else {
      attestationHashes.push(attestationHash);
      await this.set(id, attestationHashes);
    }
  }

  public async removeAttestation(id: Id, attestationHash: Hash): Promise<void> {
    const attestationHashes = await this.get(id);
    if(attestationHashes) {
      attestationHashes.forEach((value, index, array) => {
        if(value.equals(attestationHash)) {
          array.splice(index, 1);
        }
      });
      this.set(id, attestationHashes);
    }
  }

}
