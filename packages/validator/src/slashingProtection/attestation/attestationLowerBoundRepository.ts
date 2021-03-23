import {BLSPubkey, phase0} from "@chainsafe/lodestar-types";
import {Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types";

/**
 * Manages validator db storage of the minimum source and target epochs required of a validator
 * attestation.
 */
export class AttestationLowerBoundRepository {
  protected type: Type<phase0.SlashingProtectionAttestationLowerBound>;
  protected db: LodestarValidatorDatabaseController;
  protected bucket = Bucket.phase0_slashingProtectionAttestationLowerBound;

  constructor(opts: IDatabaseApiOptions) {
    this.db = opts.controller;
    this.type = opts.config.types.phase0.SlashingProtectionAttestationLowerBound;
  }

  async get(pubkey: BLSPubkey): Promise<phase0.SlashingProtectionAttestationLowerBound | null> {
    const att = await this.db.get(this.encodeKey(pubkey));
    return att && this.type.deserialize(att);
  }

  async set(pubkey: BLSPubkey, value: phase0.SlashingProtectionAttestationLowerBound): Promise<void> {
    await this.db.put(this.encodeKey(pubkey), Buffer.from(this.type.serialize(value)));
  }

  private encodeKey(pubkey: BLSPubkey): Buffer {
    return encodeKey(this.bucket, Buffer.from(pubkey as Uint8Array));
  }
}
