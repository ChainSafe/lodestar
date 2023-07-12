import {ContainerType, Type} from "@chainsafe/ssz";
import {BLSPubkey, Epoch, ssz} from "@lodestar/types";
import {intToBytes, bytesToInt} from "@lodestar/utils";
import {DB_PREFIX_LENGTH, DbReqOpts, encodeKey, uintLen} from "@lodestar/db";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {SlashingProtectionAttestation} from "../types.js";
import {blsPubkeyLen, uniqueVectorArr} from "../utils.js";
import {Bucket, getBucketNameByValue} from "../../buckets.js";

/**
 * Manages validator db storage of attestations.
 * Entries in the db are indexed by an encoded key which combines the validator's public key and the
 * attestation's target epoch.
 */
export class AttestationByTargetRepository {
  protected type: Type<SlashingProtectionAttestation>;
  protected bucket = Bucket.slashingProtectionAttestationByTarget;

  private readonly bucketId = getBucketNameByValue(this.bucket);
  private readonly dbReqOpts: DbReqOpts = {bucketId: this.bucketId};
  private readonly minKey: Uint8Array;
  private readonly maxKey: Uint8Array;

  constructor(protected db: LodestarValidatorDatabaseController) {
    this.type = new ContainerType({
      sourceEpoch: ssz.Epoch,
      targetEpoch: ssz.Epoch,
      signingRoot: ssz.Root,
    }); // casing doesn't matter
    this.minKey = encodeKey(this.bucket, Buffer.alloc(0));
    this.maxKey = encodeKey(this.bucket + 1, Buffer.alloc(0));
  }

  async getAll(pubkey: BLSPubkey, limit?: number): Promise<SlashingProtectionAttestation[]> {
    const attestations = await this.db.values({
      limit,
      gte: this.encodeKey(pubkey, 0),
      lt: this.encodeKey(pubkey, Number.MAX_SAFE_INTEGER),
      bucketId: this.bucketId,
    });
    return attestations.map((attestation) => this.type.deserialize(attestation));
  }

  async get(pubkey: BLSPubkey, targetEpoch: Epoch): Promise<SlashingProtectionAttestation | null> {
    const att = await this.db.get(this.encodeKey(pubkey, targetEpoch), this.dbReqOpts);
    return att && this.type.deserialize(att);
  }

  async set(pubkey: BLSPubkey, atts: SlashingProtectionAttestation[]): Promise<void> {
    await this.db.batchPut(
      atts.map((att) => ({
        key: this.encodeKey(pubkey, att.targetEpoch),
        value: Buffer.from(this.type.serialize(att)),
      })),
      this.dbReqOpts
    );
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    const keys = await this.db.keys({gte: this.minKey, lt: this.maxKey, bucketId: this.bucketId});
    return uniqueVectorArr(keys.map((key) => this.decodeKey(key).pubkey));
  }

  private encodeKey(pubkey: BLSPubkey, targetEpoch: Epoch): Uint8Array {
    return encodeKey(this.bucket, Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(targetEpoch), uintLen, "be")]));
  }

  private decodeKey(key: Uint8Array): {pubkey: BLSPubkey; targetEpoch: Epoch} {
    return {
      pubkey: key.slice(DB_PREFIX_LENGTH, DB_PREFIX_LENGTH + blsPubkeyLen),
      targetEpoch: bytesToInt(
        key.slice(DB_PREFIX_LENGTH + blsPubkeyLen, DB_PREFIX_LENGTH + blsPubkeyLen + uintLen),
        "be"
      ),
    };
  }
}
