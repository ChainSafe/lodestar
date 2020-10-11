import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSPubkey, SlashingProtectionBlock, Slot} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {IDatabaseController} from "@chainsafe/lodestar/lib/db";
import {Bucket, encodeKey} from "@chainsafe/lodestar/lib/db/api/schema";
import {Type} from "@chainsafe/ssz";

export class SlashingProtectionBlockRepository {
  protected type: Type<SlashingProtectionBlock>;
  protected db: IDatabaseController<Buffer, Buffer>;
  protected bucket = 0; // Bucket.slashingProtectionBlock;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.db = db;
    this.type = config.types.SlashingProtectionBlock;
  }

  async getAllByPubkey(pubkey: BLSPubkey, limit?: number): Promise<SlashingProtectionBlock[]> {
    const blocks = await this.db.values({
      limit,
      gte: this.encodeKey(pubkey, 0),
      lt: this.encodeKey(pubkey, Number.MAX_SAFE_INTEGER),
    });
    return blocks.map((block) => this.type.deserialize(block));
  }

  async getFirstByPubkey(pubkey: BLSPubkey): Promise<SlashingProtectionBlock | null> {
    const blocks = await this.getAllByPubkey(pubkey, 1);
    return blocks[0] ?? null;
  }

  async getByPubkeyAndSlot(pubkey: BLSPubkey, slot: Slot): Promise<SlashingProtectionBlock | null> {
    const block = await this.db.get(this.encodeKey(pubkey, slot));
    return block && this.type.deserialize(block);
  }

  async setByPubkey(pubkey: BLSPubkey, blocks: SlashingProtectionBlock[]): Promise<void> {
    await this.db.batchPut(
      blocks.map((block) => ({
        key: this.encodeKey(pubkey, block.slot),
        value: Buffer.from(this.type.serialize(block)),
      }))
    );
  }

  private encodeKey(pubkey: BLSPubkey, slot: Slot): Buffer {
    return encodeKey(this.bucket, getBlockKey(pubkey, slot));
  }
}

function getBlockKey(pubkey: BLSPubkey, slot: Slot): Buffer {
  return Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(slot), 8, "be")]);
}
