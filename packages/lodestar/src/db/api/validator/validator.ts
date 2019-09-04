/**
 * @module db/api/validator
 */

import {deserialize, serialize} from "@chainsafe/ssz";
import deepmerge from "deepmerge";
import {Attestation, BeaconBlock, BLSPubkey} from "@chainsafe/eth2.0-types";
import {DatabaseApiOptions, DatabaseService} from "../abstract";
import {AttestationSearchOptions, IValidatorDB} from "./interface";
import {Bucket, encodeKey} from "../../schema";
import BN from "bn.js";

export class ValidatorDB extends DatabaseService implements IValidatorDB {
  public constructor(opts: DatabaseApiOptions) {
    super(opts);
  }

  public async getBlock(pubKey: BLSPubkey): Promise<BeaconBlock> {
    const data = await this.db.get(
      encodeKey(Bucket.lastProposedBlock, pubKey.toString('hex'))
    );
    return deserialize(data, this.config.types.BeaconBlock);
  }

  public async setBlock(pubKey: BLSPubkey,  block: BeaconBlock): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.lastProposedBlock, pubKey.toString('hex')),
      serialize(block, this.config.types.BeaconBlock)
    );
  }

  public async getAttestations(
    pubKey: BLSPubkey,
    options: AttestationSearchOptions): Promise<Attestation[]> {
    options = deepmerge({gt: 0, lt: Number.MAX_SAFE_INTEGER}, options);
    const data = await this.db.search({
      gt: encodeKey(Bucket.proposedAttestations, "" + pubKey.toString('hex') + options.gt),
      lt: encodeKey(Bucket.proposedAttestations, "" + this.incrementPubKey(pubKey) + options.lt)
    });
    return data.map((data) => deserialize(data, this.config.types.Attestation));
  }

  public async setAttestation(pubKey: BLSPubkey, attestation: Attestation): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.proposedAttestations, "" + pubKey.toString('hex') + attestation.data.target.epoch),
      serialize(attestation, this.config.types.Attestation)
    );
  }

  public async deleteAttestations(pubKey: BLSPubkey, attestations: Attestation[]): Promise<void> {
    const criteria: any[] = [];
    attestations.forEach((attestation) =>
      criteria.push(encodeKey(Bucket.proposedAttestations, "" + pubKey.toString('hex') + attestation.data.target.epoch))
    );
    await this.db.batchDelete(criteria);
  }

  private incrementPubKey(pubKey: BLSPubkey): string {
    return new BN(pubKey).addn(1).toString('hex').replace('0x', '');
  }

}
