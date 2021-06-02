import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {IDatabaseController, Bucket} from "@chainsafe/lodestar-db";

export class LatestNonFinalizedUpdate {
  private readonly bucket = Bucket.altair_latestNonFinalizedUpdate;
  private readonly key = Buffer.from(new Uint8Array([this.bucket]));
  private readonly type: Type<altair.LightClientUpdate>;
  private readonly db: IDatabaseController<Buffer, Buffer>;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.db = db;
    this.type = ssz.altair.LightClientUpdate;
  }

  async put(value: altair.LightClientUpdate): Promise<void> {
    await this.db.put(this.key, this.type.serialize(value) as Buffer);
  }

  async get(): Promise<altair.LightClientUpdate | null> {
    const value = await this.db.get(this.key);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
