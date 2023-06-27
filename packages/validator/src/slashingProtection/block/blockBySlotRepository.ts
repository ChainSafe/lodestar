import {BLSPubkey, Slot, ssz} from "@lodestar/types";
import {intToBytes, bytesToInt} from "@lodestar/utils";
import {DB_PREFIX_LENGTH, DbReqOpts, encodeKey, uintLen} from "@lodestar/db";
import {ContainerType, Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {Bucket, getBucketNameByValue} from "../../buckets.js";
import {SlashingProtectionBlock} from "../types.js";
import {blsPubkeyLen, uniqueVectorArr} from "../utils.js";

/**
 * Manages validator db storage of blocks.
 * Entries in the db are indexed by an encoded key which combines the validator's public key and the
 * block's slot.
 */
export class BlockBySlotRepository {
  protected type: Type<SlashingProtectionBlock>;
  protected bucket = Bucket.slashingProtectionBlockBySlot;

  private readonly bucketId = getBucketNameByValue(this.bucket);
  private readonly dbReqOpts: DbReqOpts = {bucketId: this.bucketId};
  private readonly minKey: Uint8Array;
  private readonly maxKey: Uint8Array;

  constructor(protected db: LodestarValidatorDatabaseController) {
    this.type = new ContainerType({
      slot: ssz.Slot,
      signingRoot: ssz.Root,
    }); // casing doesn't matter
    this.minKey = encodeKey(this.bucket, Buffer.alloc(0));
    this.maxKey = encodeKey(this.bucket + 1, Buffer.alloc(0));
  }

  async getAll(pubkey: BLSPubkey, limit?: number): Promise<SlashingProtectionBlock[]> {
    const blocks = await this.db.values({
      limit,
      gte: this.encodeKey(pubkey, 0),
      lt: this.encodeKey(pubkey, Number.MAX_SAFE_INTEGER),
      bucketId: this.bucketId,
    });
    return blocks.map((block) => this.type.deserialize(block));
  }

  async getFirst(pubkey: BLSPubkey): Promise<SlashingProtectionBlock | null> {
    const blocks = await this.getAll(pubkey, 1);
    return blocks[0] ?? null;
  }

  async get(pubkey: BLSPubkey, slot: Slot): Promise<SlashingProtectionBlock | null> {
    const block = await this.db.get(this.encodeKey(pubkey, slot), this.dbReqOpts);
    return block && this.type.deserialize(block);
  }

  async set(pubkey: BLSPubkey, blocks: SlashingProtectionBlock[]): Promise<void> {
    await this.db.batchPut(
      blocks.map((block) => ({
        key: this.encodeKey(pubkey, block.slot),
        value: Buffer.from(this.type.serialize(block)),
      })),
      this.dbReqOpts
    );
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    const keys = await this.db.keys({gte: this.minKey, lt: this.maxKey, bucketId: this.bucketId});
    return uniqueVectorArr(keys.map((key) => this.decodeKey(key).pubkey));
  }

  private encodeKey(pubkey: BLSPubkey, slot: Slot): Uint8Array {
    return encodeKey(this.bucket, Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(slot), uintLen, "be")]));
  }

  private decodeKey(key: Uint8Array): {pubkey: BLSPubkey; slot: Slot} {
    return {
      pubkey: key.slice(DB_PREFIX_LENGTH, DB_PREFIX_LENGTH + blsPubkeyLen),
      slot: bytesToInt(key.slice(DB_PREFIX_LENGTH, DB_PREFIX_LENGTH + uintLen), "be"),
    };
  }
}
