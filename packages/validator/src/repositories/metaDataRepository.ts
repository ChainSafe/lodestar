import {Bucket, encodeKey, DatabaseApiOptions, DbReqOpts, getBucketNameByValue} from "@lodestar/db";
import {Root, UintNum64} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {LodestarValidatorDatabaseController} from "../types.js";

const GENESIS_VALIDATORS_ROOT = Buffer.from("GENESIS_VALIDATORS_ROOT");
const GENESIS_TIME = Buffer.from("GENESIS_TIME");

/**
 * Store MetaData of validator.
 */
export class MetaDataRepository {
  protected db: LodestarValidatorDatabaseController;
  protected bucket = Bucket.validator_metaData;

  private readonly bucketId: string;
  private readonly dbReqOpts: DbReqOpts;

  constructor(opts: DatabaseApiOptions) {
    this.db = opts.controller;
    this.bucketId = getBucketNameByValue(this.bucket);
    this.dbReqOpts = {bucketId: this.bucketId};
  }

  async getGenesisValidatorsRoot(): Promise<Root | null> {
    return this.db.get(this.encodeKey(GENESIS_VALIDATORS_ROOT), this.dbReqOpts);
  }

  async setGenesisValidatorsRoot(genesisValidatorsRoot: Root): Promise<void> {
    await this.db.put(this.encodeKey(GENESIS_VALIDATORS_ROOT), Buffer.from(genesisValidatorsRoot), this.dbReqOpts);
  }

  async getGenesisTime(): Promise<UintNum64 | null> {
    const bytes = await this.db.get(this.encodeKey(GENESIS_TIME), this.dbReqOpts);
    return bytes ? ssz.UintNum64.deserialize(bytes) : null;
  }

  async setGenesisTime(genesisTime: UintNum64): Promise<void> {
    await this.db.put(this.encodeKey(GENESIS_TIME), Buffer.from(ssz.UintNum64.serialize(genesisTime)), this.dbReqOpts);
  }

  private encodeKey(key: Uint8Array): Uint8Array {
    return encodeKey(this.bucket, key);
  }
}
