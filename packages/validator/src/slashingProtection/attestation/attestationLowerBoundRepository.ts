import {BLSPubkey, Epoch, ssz} from "@chainsafe/lodestar-types";
import {Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {ContainerType, Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types.js";

// Only used locally here
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface SlashingProtectionLowerBound {
  minSourceEpoch: Epoch;
  minTargetEpoch: Epoch;
}

/**
 * Manages validator db storage of the minimum source and target epochs required of a validator
 * attestation.
 */
export class AttestationLowerBoundRepository {
  protected type: Type<SlashingProtectionLowerBound>;
  protected db: LodestarValidatorDatabaseController;
  protected bucket = Bucket.phase0_slashingProtectionAttestationLowerBound;

  constructor(opts: IDatabaseApiOptions) {
    this.db = opts.controller;
    this.type = new ContainerType({
      minSourceEpoch: ssz.Epoch,
      minTargetEpoch: ssz.Epoch,
    }); // casing doesn't matter
  }

  async get(pubkey: BLSPubkey): Promise<SlashingProtectionLowerBound | null> {
    const att = await this.db.get(this.encodeKey(pubkey));
    return att && this.type.deserialize(att);
  }

  async set(pubkey: BLSPubkey, value: SlashingProtectionLowerBound): Promise<void> {
    await this.db.put(this.encodeKey(pubkey), Buffer.from(this.type.serialize(value)));
  }

  private encodeKey(pubkey: BLSPubkey): Uint8Array {
    return encodeKey(this.bucket, Buffer.from(pubkey as Uint8Array));
  }
}
