import {NumberUintType} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket} from "@chainsafe/lodestar-db";

export class PreGenesisStateLastProcessedBlock {
  private readonly bucket: Bucket;
  private readonly type: NumberUintType;
  private readonly db: IDatabaseController<Buffer, Buffer>;
  private readonly key: Buffer;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.db = db;
    this.type = config.types.Number64;
    this.bucket = Bucket.phase0_preGenesisStateLastProcessedBlock as Bucket;
    this.key = Buffer.from(new Uint8Array([this.bucket]));
  }

  async put(value: number): Promise<void> {
    await this.db.put(this.key, this.type.serialize(value) as Buffer);
  }

  async get(): Promise<number | null> {
    const value = await this.db.get(this.key);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
