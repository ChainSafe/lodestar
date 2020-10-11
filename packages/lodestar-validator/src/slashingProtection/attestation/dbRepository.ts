import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSPubkey, Epoch, SlashingProtectionAttestation} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {IDatabaseController} from "@chainsafe/lodestar/lib/db";
import {Bucket, encodeKey} from "@chainsafe/lodestar/lib/db/api/schema";
import {Type} from "@chainsafe/ssz";

interface ITargetEpochFilter {
  gte?: number;
  lt?: number;
}

export class SlashingProtectionAttestationRepository {
  protected type: Type<SlashingProtectionAttestation>;
  protected db: IDatabaseController<Buffer, Buffer>;
  protected bucket = 0; // Bucket.slashingProtectionAttestation;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.db = db;
    this.type = config.types.SlashingProtectionAttestation;
  }

  async getAllByPubkey(pubKey: BLSPubkey): Promise<SlashingProtectionAttestation[]> {
    return this.getByPubkeyAndTargetEpoch(pubKey, {});
  }

  async getByPubkeyAndTargetEpoch(
    pubKey: BLSPubkey,
    options: ITargetEpochFilter
  ): Promise<SlashingProtectionAttestation[]> {
    const data = await this.db.values({
      gte: this.encodeKey(pubKey, options.gte ?? 0),
      lt: this.encodeKey(pubKey, options.lt ?? Number.MAX_SAFE_INTEGER),
    });
    return data.map((data) => this.type.deserialize(data));
  }

  async setByPubkey(pubKey: BLSPubkey, attestations: SlashingProtectionAttestation[]): Promise<void> {
    await this.db.batchPut(
      attestations.map((attestation) => ({
        key: this.encodeKey(pubKey, attestation.targetEpoch),
        value: Buffer.from(this.type.serialize(attestation)),
      }))
    );
  }

  private encodeKey(pubKey: BLSPubkey, targetEpoch: Epoch): Buffer {
    return encodeKey(this.bucket, getAttestationKey(pubKey, targetEpoch));
  }
}

function getAttestationKey(pubkey: BLSPubkey, targetEpoch: Epoch): Buffer {
  return Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(targetEpoch), 8, "be")]);
}
