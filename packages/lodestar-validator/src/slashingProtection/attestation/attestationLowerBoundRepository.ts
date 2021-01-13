import {BLSPubkey, SlashingProtectionAttestationLowerBound} from "@chainsafe/lodestar-types";
import {IDatabaseController, Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";
import {FORK_VERSION_STUB} from "../const";

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
    return encodeKey(this.bucket, FORK_VERSION_STUB, Buffer.from(pubkey));
  }
}
