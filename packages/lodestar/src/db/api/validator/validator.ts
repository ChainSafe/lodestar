/**
 * @module db/api/validator
 */

import {deserialize, serialize} from "@chainsafe/ssz";
import deepmerge from "deepmerge";
import {Attestation, BeaconBlock, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {IDatabaseApiOptions, DatabaseService} from "../abstract";
import {IAttestationSearchOptions, IValidatorDB} from "./interface";
import {Bucket, encodeKey} from "../../schema";

export class ValidatorDB extends DatabaseService implements IValidatorDB {
  public constructor(opts: IDatabaseApiOptions) {
    super(opts);
  }

  public async getBlock(index: ValidatorIndex): Promise<BeaconBlock|null> {
    const data = await this.db.get(
      encodeKey(Bucket.lastProposedBlock, index)
    );
    if(!data) {
      return null;
    }
    return deserialize(data, this.config.types.BeaconBlock);
  }

  public async setBlock(index: ValidatorIndex, block: BeaconBlock): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.lastProposedBlock, index),
      serialize(block, this.config.types.BeaconBlock)
    );
  }

  public async getAttestations(
    index: ValidatorIndex,
    options: IAttestationSearchOptions): Promise<Attestation[]> {
    options = deepmerge({gt: 0, lt: Number.MAX_SAFE_INTEGER}, options);
    const data = await this.db.search({
      gt: encodeKey(Bucket.proposedAttestations, "" + index + options.gt),
      lt: encodeKey(Bucket.proposedAttestations, "" + index + options.lt)
    });
    return data.map((data) => deserialize(data, this.config.types.Attestation));
  }

  public async setAttestation(index: ValidatorIndex, attestation: Attestation): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.proposedAttestations, "" + index + attestation.data.target.epoch),
      serialize(attestation, this.config.types.Attestation)
    );
  }

  public async deleteAttestations(index: ValidatorIndex, attestations: Attestation[]): Promise<void> {
    const criteria: (Buffer|string)[] = [];
    attestations.forEach((attestation) =>
      criteria.push(encodeKey(Bucket.proposedAttestations, "" + index + attestation.data.target.epoch))
    );
    await this.db.batchDelete(criteria);
  }

}
