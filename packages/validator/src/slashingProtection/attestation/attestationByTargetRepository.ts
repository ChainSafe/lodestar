import {BLSPubkey, Epoch, ssz} from "@chainsafe/lodestar-types";
import {intToBytes, bytesToInt} from "@chainsafe/lodestar-utils";
import {Bucket, DB_PREFIX_LENGTH, encodeKey, IDatabaseApiOptions, uintLen} from "@chainsafe/lodestar-db";
import {ContainerType, Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {SlashingProtectionAttestation} from "../types.js";
import {blsPubkeyLen, uniqueVectorArr} from "../utils.js";

/**
 * Manages validator db storage of attestations.
 * Entries in the db are indexed by an encoded key which combines the validator's public key and the
 * attestation's target epoch.
 */
export class AttestationByTargetRepository {
  protected type: Type<SlashingProtectionAttestation>;
  protected db: LodestarValidatorDatabaseController;
  protected bucket = Bucket.phase0_slashingProtectionAttestationByTarget;

  constructor(opts: IDatabaseApiOptions) {
    this.db = opts.controller;
    this.type = new ContainerType({
      sourceEpoch: ssz.Epoch,
      targetEpoch: ssz.Epoch,
      signingRoot: ssz.Root,
    }); // casing doesn't matter
  }

  async getAll(pubkey: BLSPubkey, limit?: number): Promise<SlashingProtectionAttestation[]> {
    const attestations = await this.db.values({
      limit,
      gte: this.encodeKey(pubkey, 0),
      lt: this.encodeKey(pubkey, Number.MAX_SAFE_INTEGER),
    });
    return attestations.map((attestation) => this.type.deserialize(attestation));
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

  private encodeKey(pubkey: BLSPubkey, targetEpoch: Epoch): Uint8Array {
    return encodeKey(
      this.bucket,
      Buffer.concat([Buffer.from(pubkey as Uint8Array), intToBytes(BigInt(targetEpoch), uintLen, "be")])
    );
  }

  private decodeKey(key: Uint8Array): {pubkey: BLSPubkey; targetEpoch: Epoch} {
    return {
      pubkey: key.slice(DB_PREFIX_LENGTH, DB_PREFIX_LENGTH + blsPubkeyLen),
      targetEpoch: bytesToInt(
        key.slice(DB_PREFIX_LENGTH + blsPubkeyLen, DB_PREFIX_LENGTH + blsPubkeyLen + uintLen),
        "be"
      ),
    };
  }
}
