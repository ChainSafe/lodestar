import {UintNumberType} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {Db} from "@lodestar/db";
import {Bucket} from "../buckets.js";

export class PreGenesisStateLastProcessedBlock {
  private readonly bucket: Bucket;
  private readonly type: UintNumberType;
  private readonly db: Db;
  private readonly key: Uint8Array;

  constructor(_config: ChainForkConfig, db: Db) {
    this.db = db;
    this.type = ssz.UintNum64;
    this.bucket = Bucket.phase0_preGenesisStateLastProcessedBlock;
    this.key = new Uint8Array([this.bucket]);
  }

  async put(value: number): Promise<void> {
    await this.db.put(this.key, this.type.serialize(value));
  }

  async get(): Promise<number | null> {
    const value = await this.db.get(this.key);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
