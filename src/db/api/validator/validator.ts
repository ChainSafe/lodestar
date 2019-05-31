/**
 * @module db/api/validator
 */

import {DatabaseService, DatabaseApiOptions} from "../abstract";
import {AttestationSearchOptions, IValidatorDB} from "./interface";
import {Attestation, BeaconBlock, ValidatorIndex} from "../../../types";
import {Bucket, encodeKey} from "../../schema";
import {deserialize, hashTreeRoot, serialize} from "@chainsafe/ssz";
import deepmerge from "deepmerge";

export class ValidatorDB extends DatabaseService implements IValidatorDB {

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

  public async getAttestations(
    index: ValidatorIndex,
    options: AttestationSearchOptions): Promise<Attestation[]> {
    options = deepmerge({gt: 0, lt: Number.MAX_SAFE_INTEGER}, options);
    const data = await this.db.search({
      gt: encodeKey(Bucket.proposedAttestations, "" + index + options.gt),
      lt: encodeKey(Bucket.proposedAttestations, "" + index + options.lt)
    });
    return data.map((data) => deserialize(data, Attestation));
  }

  public async setAttestation(index: ValidatorIndex, attestation: Attestation): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.proposedAttestations, "" + index + attestation.data.targetEpoch),
      serialize(attestation, Attestation)
    );
  }

  public async deleteAttestations(index: ValidatorIndex, attestations: Attestation[]): Promise<void> {
    const criteria: any[] = [];
    attestations.forEach((attestation) =>
      criteria.push(encodeKey(Bucket.proposedAttestations, "" + index + attestation.data.targetEpoch))
    );
    await this.db.batchDelete(criteria);
  }

}
