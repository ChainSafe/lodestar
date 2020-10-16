import {
  BLSPubkey,
  Epoch,
  SlashingProtectionAttestation,
  SlashingProtectionAttestationLowerBound,
} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";

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

  private encodeKey(pubkey: BLSPubkey, targetEpoch: Epoch): Buffer {
    return encodeKey(this.bucket, Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(targetEpoch), 8, "be")]));
  }
}

export class AttestationLowerBoundRepository {
  protected type: Type<SlashingProtectionAttestationLowerBound>;
  protected db: IDatabaseController<Buffer, Buffer>;
  protected bucket = Bucket.slashingProtectionAttestationLowerBound;

  constructor(opts: IDatabaseApiOptions) {
    this.db = opts.controller;
    this.type = opts.config.types.SlashingProtectionAttestationLowerBound;
  }

  async get(pubkey: BLSPubkey): Promise<SlashingProtectionAttestationLowerBound | null> {
    const att = await this.db.get(this.encodeKey(pubkey));
    return att && this.type.deserialize(att);
  }

  async set(pubkey: BLSPubkey, value: SlashingProtectionAttestationLowerBound): Promise<void> {
    await this.db.put(this.encodeKey(pubkey), Buffer.from(this.type.serialize(value)));
  }

  private encodeKey(pubkey: BLSPubkey): Buffer {
    return encodeKey(this.bucket, Buffer.from(pubkey));
  }
}
