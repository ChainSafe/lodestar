/**
 * @module db/api/validator
 */

import deepmerge from "deepmerge";
import {Attestation, BLSPubkey, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {DatabaseService, IDatabaseApiOptions} from "../abstract";
import {IAttestationSearchOptions, IValidatorDB} from "./interface";
import {Bucket, encodeKey} from "../../schema";
import {bytesToBigInt} from "@chainsafe/eth2.0-utils";

export class ValidatorDB extends DatabaseService implements IValidatorDB {
  public constructor(opts: IDatabaseApiOptions) {
    super(opts);
  }

  public async getBlock(pubKey: BLSPubkey): Promise<SignedBeaconBlock|null> {
    const data = await this.db.get(
      encodeKey(Bucket.lastProposedBlock, pubKey.toString("hex"))
    );
    if(!data) {
      return null;
    }
    return this.config.types.SignedBeaconBlock.deserialize(data);
  }

  public async setBlock(pubKey: BLSPubkey, signedBlock: SignedBeaconBlock): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.lastProposedBlock, pubKey.toString("hex")),
      this.config.types.SignedBeaconBlock.serialize(signedBlock)
    );
  }

  public async getAttestations(
    pubKey: BLSPubkey,
    options: IAttestationSearchOptions): Promise<Attestation[]> {
    options = deepmerge({gt: 0, lt: Number.MAX_SAFE_INTEGER}, options);
    const data = await this.db.search({
      gt: encodeKey(Bucket.proposedAttestations, "" + pubKey.toString("hex") + options.gt),
      lt: encodeKey(Bucket.proposedAttestations, "" + this.incrementPubKey(pubKey) + options.lt)
    });
    return data.map((data) => this.config.types.Attestation.deserialize(data));
  }

  public async setAttestation(pubKey: BLSPubkey, attestation: Attestation): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.proposedAttestations, "" + pubKey.toString("hex") + attestation.data.target.epoch),
      this.config.types.Attestation.serialize(attestation)
    );
  }

  public async deleteAttestations(pubKey: BLSPubkey, attestations: Attestation[]): Promise<void> {
    const criteria: ReturnType<typeof encodeKey>[] = [];
    attestations.forEach((attestation) =>
      criteria.push(encodeKey(Bucket.proposedAttestations, "" + pubKey.toString("hex") + attestation.data.target.epoch))
    );
    await this.db.batchDelete(criteria);
  }

  private incrementPubKey(pubKey: BLSPubkey): string {
    return (bytesToBigInt(pubKey) + 1n).toString(16).replace("0x", "");
  }

}
