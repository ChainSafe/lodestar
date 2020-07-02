/**
 * @module db/api/validator
 */

import deepmerge from "deepmerge";
import {toHexString} from "@chainsafe/ssz";
import {Attestation, BLSPubkey, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {bytesToBigInt, bigIntToBytes} from "@chainsafe/lodestar-utils";

import {DatabaseService, IDatabaseApiOptions} from "../abstract";
import {IAttestationSearchOptions, IValidatorDB} from "./interface";
import {Bucket, encodeKey} from "../schema";

export class ValidatorDB extends DatabaseService implements IValidatorDB {
  public constructor(opts: IDatabaseApiOptions) {
    super(opts);
  }

  public async getBlock(pubKey: BLSPubkey): Promise<SignedBeaconBlock|null> {
    const data = await this.db.get(
      encodeKey(Bucket.lastProposedBlock, toHexString(pubKey))
    );
    if(!data) {
      return null;
    }
    return this.config.types.SignedBeaconBlock.deserialize(data);
  }

  public async setBlock(pubKey: BLSPubkey, signedBlock: SignedBeaconBlock): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.lastProposedBlock, toHexString(pubKey)),
      this.config.types.SignedBeaconBlock.serialize(signedBlock) as Buffer
    );
  }

  public async getAttestations(
    pubKey: BLSPubkey,
    options: IAttestationSearchOptions): Promise<Attestation[]> {
    options = deepmerge({gt: 0, lt: Number.MAX_SAFE_INTEGER}, options);
    const data = await this.db.values({
      gt: encodeKey(Bucket.proposedAttestations, "" + toHexString(pubKey) + options.gt),
      lt: encodeKey(Bucket.proposedAttestations, "" + toHexString(this.incrementPubKey(pubKey)) + options.lt)
    });
    return data.map((data) => this.config.types.Attestation.deserialize(data));
  }

  public async setAttestation(pubKey: BLSPubkey, attestation: Attestation): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.proposedAttestations, "" + toHexString(pubKey) + attestation.data.target.epoch),
      this.config.types.Attestation.serialize(attestation) as Buffer
    );
  }

  public async deleteAttestations(pubKey: BLSPubkey, attestations: Attestation[]): Promise<void> {
    const criteria: ReturnType<typeof encodeKey>[] = [];
    attestations.forEach((attestation) =>
      criteria.push(encodeKey(Bucket.proposedAttestations, "" + toHexString(pubKey) + attestation.data.target.epoch))
    );
    await this.db.batchDelete(criteria);
  }

  private incrementPubKey(pubKey: BLSPubkey): BLSPubkey {
    return bigIntToBytes(bytesToBigInt(pubKey.valueOf() as Uint8Array) + BigInt(1), this.config.types.BLSPubkey.length);
  }

}
