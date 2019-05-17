/**
 * @module db/api/validator
 */

import {DatabaseApi, DatabaseApiOptions} from "../abstract";
import {IValidatorDB} from "./interface";
import {Attestation, BeaconBlock, ValidatorIndex} from "../../../types";
import {Bucket, encodeKey} from "../../schema";
import {deserialize, serialize} from "@chainsafe/ssz";

export class ValidatorDB extends DatabaseApi implements IValidatorDB {

  public constructor(opts: DatabaseApiOptions) {
    super(opts);
  }

  public async getBlock(index: ValidatorIndex): Promise<BeaconBlock> {
    const data = await this.db.get(
      encodeKey(Bucket.lastProposedBlock, index)
    );
    return deserialize(data, BeaconBlock);
  }

  public async setBlock(index: ValidatorIndex, block: BeaconBlock): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.lastProposedBlock, index),
      serialize(block, BeaconBlock)
    );
  }

  public async getAttestation(index: ValidatorIndex): Promise<Attestation> {
    const data = await this.db.get(
      encodeKey(Bucket.lastProposedAttestation, index)
    );
    return deserialize(data, Attestation);
  }

  public async setAttestation(index: ValidatorIndex, attestation: Attestation): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.lastProposedAttestation, index),
      serialize(attestation, Attestation)
    );
  }

}
