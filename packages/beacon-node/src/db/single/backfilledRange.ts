import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, DbReqOpts, encodeKey} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export const backfilledRangeWrapperSsz = new ContainerType(
  {beginningEpoch: ssz.Epoch, endingEpoch: ssz.Epoch},
  {typeName: "BackfilledRange", jsonCase: "eth2"}
);
export type BackfilledRangeWrapper = ValueOf<typeof backfilledRangeWrapperSsz>;
export const BACKFILLED_RANGE_KEY = -1;

export class BackfilledRange {
  private readonly db: Db;
  private readonly key: Uint8Array;
  private readonly dbReqOpts: DbReqOpts;

  constructor(_config: ChainForkConfig, db: Db) {
    this.db = db;
    this.key = encodeKey(Bucket.backfill_state, BACKFILLED_RANGE_KEY);
    this.dbReqOpts = {bucketId: getBucketNameByValue(Bucket.backfill_state)};
  }

  async put(value: BackfilledRangeWrapper): Promise<void> {
    await this.db.put(this.key, backfilledRangeWrapperSsz.serialize(value), this.dbReqOpts);
  }

  async get(): Promise<BackfilledRangeWrapper | null> {
    const value = await this.db.get(this.key, this.dbReqOpts);
    return value ? backfilledRangeWrapperSsz.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key, this.dbReqOpts);
  }
}
