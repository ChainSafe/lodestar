import {Bucket, encodeKey, IDatabaseApiOptions, IDatabaseController, uintLen} from "@chainsafe/lodestar-db";
import {BLSPubkey, Epoch, SlashingProtectionAttestation} from "@chainsafe/lodestar-types";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";
import {Type} from "@chainsafe/ssz";
import {DB_PREFIX_LENGTH, FORK_VERSION_STUB} from "..";
import {blsPubkeyLen, uniqueVectorArr} from "../utils";

export class AttestationByTargetRepository {
  protected type: Type<SlashingProtectionAttestation>;
  protected db: IDatabaseController<Buffer, Buffer>;
  protected bucket = Bucket.slashingProtectionAttestationByTarget;

  constructor(opts: IDatabaseApiOptions) {
    this.db = opts.controller;
    this.type = opts.config.types.SlashingProtectionAttestation;
  }

  async getAll(pubkey: BLSPubkey, limit?: number): Promise<SlashingProtectionAttestation[]> {
    const blocks = await this.db.values({
      limit,
      gte: this.encodeKey(pubkey, 0),
      lt: this.encodeKey(pubkey, Number.MAX_SAFE_INTEGER),
    });
    return blocks.map((block) => this.type.deserialize(block));
  }

  async get(pubkey: BLSPubkey, targetEpoch: Epoch): Promise<SlashingProtectionAttestation | null> {
    const att = await this.db.get(this.encodeKey(pubkey, targetEpoch));
    return att && this.type.deserialize(att);
  }

  async set(pubkey: BLSPubkey, atts: SlashingProtectionAttestation[]): Promise<void> {
    await this.db.batchPut(
      atts.map((att) => ({
        key: this.encodeKey(pubkey, att.targetEpoch),
        value: Buffer.from(this.type.serialize(att)),
      }))
    );
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    const keys = await this.db.keys();
    return uniqueVectorArr(keys.map((key) => this.decodeKey(key).pubkey));
  }

  private encodeKey(pubkey: BLSPubkey, targetEpoch: Epoch): Buffer {
    return encodeKey(
      this.bucket,
      FORK_VERSION_STUB,
      Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(targetEpoch), uintLen, "be")])
    );
  }

  private decodeKey(key: Buffer): {pubkey: BLSPubkey; targetEpoch: Epoch} {
    return {
      pubkey: key.slice(DB_PREFIX_LENGTH, DB_PREFIX_LENGTH + blsPubkeyLen),
      targetEpoch: bytesToInt(
        key.slice(DB_PREFIX_LENGTH + blsPubkeyLen, DB_PREFIX_LENGTH + blsPubkeyLen + uintLen),
        "be"
      ),
    };
  }
}
