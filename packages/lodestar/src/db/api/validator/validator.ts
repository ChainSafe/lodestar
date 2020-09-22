/**
 * @module db/api/validator
 */

import {toHexString} from "@chainsafe/ssz";
import {Attestation, BLSPubkey, Epoch, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";

import {DatabaseService, IDatabaseApiOptions} from "../abstract";
import {IAttestationSearchOptions, IValidatorDB} from "./interface";
import {Bucket, encodeKey} from "../schema";

export class ValidatorDB extends DatabaseService implements IValidatorDB {
  public constructor(opts: IDatabaseApiOptions) {
    super(opts);
  }

  public async getBlock(pubKey: BLSPubkey): Promise<SignedBeaconBlock | null> {
    const data = await this.db.get(encodeKey(Bucket.lastProposedBlock, toHexString(pubKey)));
    if (!data) {
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

  public async getAttestations(pubKey: BLSPubkey, options: IAttestationSearchOptions): Promise<Attestation[]> {
    const data = await this.db.values({
      gte: encodeKey(Bucket.proposedAttestations, this.getAttestationKey(pubKey, options.gte ?? 0)),
      lt: encodeKey(Bucket.proposedAttestations, this.getAttestationKey(pubKey, options.lt ?? Number.MAX_SAFE_INTEGER)),
    });
    return data.map((data) => this.config.types.Attestation.deserialize(data));
  }

  public async setAttestation(pubKey: BLSPubkey, attestation: Attestation): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.proposedAttestations, this.getAttestationKey(pubKey, attestation.data.target.epoch)),
      this.config.types.Attestation.serialize(attestation) as Buffer
    );
  }

  public async deleteAttestations(pubKey: BLSPubkey, attestations: Attestation[]): Promise<void> {
    const criteria: ReturnType<typeof encodeKey>[] = [];
    attestations.forEach((attestation) =>
      criteria.push(
        encodeKey(Bucket.proposedAttestations, this.getAttestationKey(pubKey, attestation.data.target.epoch))
      )
    );
    await this.db.batchDelete(criteria);
  }

  private getAttestationKey(pubkey: BLSPubkey, targetEpoch: Epoch): Buffer {
    return Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(targetEpoch), 8, "be")]);
  }
}
