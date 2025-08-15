import {ContainerType, Type, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, DbReqOpts, encodeKey as _encodeKey} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export const backfillRangeSSZ = new ContainerType(
  {
    beginningEpoch: ssz.Epoch,
    endingEpoch: ssz.Epoch,
  },
  {typeName: "BackfillRange", jsonCase: "eth2"}
);
export type BackfillRangeWrapper = ValueOf<typeof backfillRangeSSZ>;

// unique & practically impossible key to store BackfillRange inside 'backfill_state'
// bucket which stores Epoch -> EpochBackfillState key value pairs
export const BACKFILL_RANGE_KEY = -1;

export class BackfillRange {
  private readonly bucket: Bucket;
  private readonly db: Db;
  private readonly dbReqOpts: DbReqOpts; // to record metrics
  private readonly key: Uint8Array;
  private readonly type: Type<BackfillRangeWrapper>;

  constructor(_config: ChainForkConfig, db: Db) {
    this.db = db;
    this.bucket = Bucket.backfill_state;
    this.key = _encodeKey(this.bucket, BACKFILL_RANGE_KEY);
    this.type = backfillRangeSSZ;
    this.dbReqOpts = {bucketId: getBucketNameByValue(this.bucket)};
  }

  async put(value: BackfillRangeWrapper): Promise<void> {
    await this.db.put(this.key, this.type.serialize(value), this.dbReqOpts);
  }

  async get(): Promise<BackfillRangeWrapper | null> {
    const value = await this.db.get(this.key, this.dbReqOpts);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key, this.dbReqOpts);
  }
}
