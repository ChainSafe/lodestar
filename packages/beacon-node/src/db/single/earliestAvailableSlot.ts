import {UintNumberType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db} from "@lodestar/db";
import {Slot, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class EarliestAvailableSlot {
  private readonly bucket: Bucket;
  private readonly type: UintNumberType;
  private readonly db: Db;
  private readonly key: Uint8Array;
  private readonly dbReqOpts: {bucketId: string};

  constructor(_config: ChainForkConfig, db: Db) {
    this.bucket = Bucket.allForks_earliestAvailableSlot;
    this.type = ssz.Slot;
    this.db = db;
    this.key = new Uint8Array([this.bucket]);
    this.dbReqOpts = {bucketId: getBucketNameByValue(this.bucket)};
  }

  async put(slot: Slot): Promise<void> {
    await this.db.put(this.key, this.type.serialize(slot), this.dbReqOpts);
  }

  async get(): Promise<Slot | null> {
    const value = await this.db.get(this.key, this.dbReqOpts);
    return value === null ? null : this.type.deserialize(value);
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key, this.dbReqOpts);
  }
}
