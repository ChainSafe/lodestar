import {ContainerType, Type} from "@chainsafe/ssz";
import {BLSPubkey, Epoch, ssz} from "@lodestar/types";
import {encodeKey, DbReqOpts} from "@lodestar/db";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {Bucket, getBucketNameByValue} from "../../buckets.js";

// Only used locally here
export interface SlashingProtectionLowerBound {
  minSourceEpoch: Epoch;
  minTargetEpoch: Epoch;
}

/**
 * Manages validator db storage of the minimum source and target epochs required of a validator
 * attestation.
 */
export class AttestationLowerBoundRepository {
  protected type: Type<SlashingProtectionLowerBound>;
  protected bucket = Bucket.slashingProtectionAttestationLowerBound;

  private readonly bucketId = getBucketNameByValue(this.bucket);
  private readonly dbReqOpts: DbReqOpts = {bucketId: this.bucketId};

  constructor(protected db: LodestarValidatorDatabaseController) {
    this.type = new ContainerType({
      minSourceEpoch: ssz.Epoch,
      minTargetEpoch: ssz.Epoch,
    }); // casing doesn't matter
    this.dbReqOpts = {bucketId: this.bucketId};
  }

  async get(pubkey: BLSPubkey): Promise<SlashingProtectionLowerBound | null> {
    const att = await this.db.get(this.encodeKey(pubkey), this.dbReqOpts);
    return att && this.type.deserialize(att);
  }

  async set(pubkey: BLSPubkey, value: SlashingProtectionLowerBound): Promise<void> {
    await this.db.put(this.encodeKey(pubkey), Buffer.from(this.type.serialize(value)), this.dbReqOpts);
  }

  private encodeKey(pubkey: BLSPubkey): Uint8Array {
    return encodeKey(this.bucket, Buffer.from(pubkey));
  }
}
