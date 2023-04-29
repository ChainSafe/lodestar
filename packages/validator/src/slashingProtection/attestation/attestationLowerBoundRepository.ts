import {BLSPubkey, Epoch, ssz} from "@lodestar/types";
import {Bucket, encodeKey, DatabaseApiOptions, DbReqOpts, getBucketNameByValue} from "@lodestar/db";
import {ContainerType, Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types.js";

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
  protected db: LodestarValidatorDatabaseController;
  protected bucket = Bucket.phase0_slashingProtectionAttestationLowerBound;

  private readonly bucketId: string;
  private readonly dbReqOpts: DbReqOpts;

  constructor(opts: DatabaseApiOptions) {
    this.db = opts.controller;
    this.type = new ContainerType({
      minSourceEpoch: ssz.Epoch,
      minTargetEpoch: ssz.Epoch,
    }); // casing doesn't matter
    this.bucketId = getBucketNameByValue(this.bucket);
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
