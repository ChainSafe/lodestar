import {ChainForkConfig} from "@lodestar/config";
import {Db, DbReqOpts} from "@lodestar/db";
import {ForkAll, GENESIS_SLOT} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {SSZTypesFor} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class PreGenesisState {
  private readonly config: ChainForkConfig;
  private readonly bucket: Bucket;
  private readonly db: Db;
  private readonly key: Uint8Array;
  private readonly type: SSZTypesFor<ForkAll, "BeaconState">;
  private readonly dbReqOpts: DbReqOpts;

  constructor(config: ChainForkConfig, db: Db) {
    this.config = config;
    this.db = db;
    this.bucket = Bucket.phase0_preGenesisState;
    this.key = new Uint8Array([this.bucket]);
    this.type = this.config.getForkTypes(GENESIS_SLOT).BeaconState;
    this.dbReqOpts = {bucketId: getBucketNameByValue(this.bucket)};
  }

  async put(value: BeaconStateAllForks): Promise<void> {
    await this.db.put(this.key, value.serialize(), this.dbReqOpts);
  }

  async get(): Promise<BeaconStateAllForks | null> {
    const value = await this.db.get(this.key, this.dbReqOpts);
    return value ? this.type.deserializeToViewDU(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key, this.dbReqOpts);
  }
}
