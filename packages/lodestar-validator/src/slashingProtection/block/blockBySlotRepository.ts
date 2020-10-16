import {BLSPubkey, SlashingProtectionBlock, Slot} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";

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

  private encodeKey(pubkey: BLSPubkey, slot: Slot): Buffer {
    return encodeKey(this.bucket, Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(slot), 8, "be")]));
  }
}
