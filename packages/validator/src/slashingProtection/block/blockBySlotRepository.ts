import {BLSPubkey, Slot, ssz} from "@lodestar/types";
import {intToBytes, bytesToInt} from "@lodestar/utils";
import {
  Bucket,
  DatabaseApiOptions,
  DB_PREFIX_LENGTH,
  DbReqOpts,
  encodeKey,
  uintLen,
  getBucketNameByValue,
} from "@lodestar/db";
import {ContainerType, Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {SlashingProtectionBlock} from "../types.js";
import {blsPubkeyLen, uniqueVectorArr} from "../utils.js";

/**
 * Manages validator db storage of blocks.
 * Entries in the db are indexed by an encoded key which combines the validator's public key and the
 * block's slot.
 */
export class BlockBySlotRepository {
  protected type: Type<SlashingProtectionBlock>;
  protected db: LodestarValidatorDatabaseController;
  protected bucket = Bucket.phase0_slashingProtectionBlockBySlot;

  private readonly bucketId: string;
  private readonly dbReqOpts: DbReqOpts;

  constructor(opts: DatabaseApiOptions) {
    this.db = opts.controller;
    this.type = new ContainerType({
      slot: ssz.Slot,
      signingRoot: ssz.Root,
    }); // casing doesn't matter
    this.bucketId = getBucketNameByValue(this.bucket);
    this.dbReqOpts = {bucketId: this.bucketId};
  }

  async getAll(pubkey: BLSPubkey, limit?: number): Promise<SlashingProtectionBlock[]> {
    const blocks = await this.db.values({
      ...this.dbReqOpts,
      limit,
      gte: this.encodeKey(pubkey, 0),
      lt: this.encodeKey(pubkey, Number.MAX_SAFE_INTEGER),
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
    const keys = await this.db.keys(this.dbReqOpts);
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
