import {Bucket, encodeKey, IDatabaseApiOptions, IDatabaseController, uintLen} from "@chainsafe/lodestar-db";
import {BLSPubkey, SlashingProtectionBlock, Slot} from "@chainsafe/lodestar-types";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";
import {Type} from "@chainsafe/ssz";
import {DB_PREFIX_LENGTH, FORK_VERSION_STUB} from "../const";
import {blsPubkeyLen, uniqueVectorArr} from "../utils";

export class BlockBySlotRepository {
  protected type: Type<SlashingProtectionBlock>;
  protected db: IDatabaseController<Buffer, Buffer>;
  protected bucket = Bucket.slashingProtectionBlockBySlot;

  constructor(opts: IDatabaseApiOptions) {
    this.db = opts.controller;
    this.type = opts.config.types.SlashingProtectionBlock;
  }

  async getAll(pubkey: BLSPubkey, limit?: number): Promise<SlashingProtectionBlock[]> {
    const blocks = await this.db.values({
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
    const block = await this.db.get(this.encodeKey(pubkey, slot));
    return block && this.type.deserialize(block);
  }

  async set(pubkey: BLSPubkey, blocks: SlashingProtectionBlock[]): Promise<void> {
    await this.db.batchPut(
      blocks.map((block) => ({
        key: this.encodeKey(pubkey, block.slot),
        value: Buffer.from(this.type.serialize(block)),
      }))
    );
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    const keys = await this.db.keys();
    return uniqueVectorArr(keys.map((key) => this.decodeKey(key).pubkey));
  }

  private encodeKey(pubkey: BLSPubkey, slot: Slot): Buffer {
    return encodeKey(
      this.bucket,
      FORK_VERSION_STUB,
      Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(slot), uintLen, "be")])
    );
  }

  private decodeKey(key: Buffer): {pubkey: BLSPubkey; slot: Slot} {
    return {
      pubkey: key.slice(DB_PREFIX_LENGTH, DB_PREFIX_LENGTH + blsPubkeyLen),
      slot: bytesToInt(key.slice(DB_PREFIX_LENGTH, DB_PREFIX_LENGTH + uintLen), "be"),
    };
  }
}
