import {ContainerType, Type, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, DbReqOpts} from "@lodestar/db";
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

// Note: intToBytes(-1) incorrectly encodes to 0x0000000000000001, so we manually
// encode as 0xFFFFFFFFFFFFFFFF (two's complement big-endian representation of -1)
// This ensures no collision with epoch keys
const BACKFILL_RANGE_KEY_BYTES = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const BUCKET_PREFIX_LEN = 1;
const KEY_LEN = 8;

function encodeBackfillRangeKey(bucket: number): Uint8Array {
  const buf = new Uint8Array(BUCKET_PREFIX_LEN + KEY_LEN);
  buf[0] = bucket;
  buf.set(BACKFILL_RANGE_KEY_BYTES, BUCKET_PREFIX_LEN);
  return buf;
}

export class BackfillRange {
  private readonly bucket: Bucket;
  private readonly db: Db;
  private readonly dbReqOpts: DbReqOpts; // to record metrics
  private readonly key: Uint8Array;
  private readonly type: Type<BackfillRangeWrapper>;

  constructor(_config: ChainForkConfig, db: Db) {
    this.db = db;
    this.bucket = Bucket.backfill_state;
    this.key = encodeBackfillRangeKey(this.bucket);
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
