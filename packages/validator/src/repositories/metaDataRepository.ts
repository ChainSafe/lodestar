import {encodeKey, DbReqOpts} from "@lodestar/db";
import {Root, UintNum64} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {LodestarValidatorDatabaseController} from "../types.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const GENESIS_VALIDATORS_ROOT = Buffer.from("GENESIS_VALIDATORS_ROOT");
const GENESIS_TIME = Buffer.from("GENESIS_TIME");

/**
 * Store MetaData of validator.
 */
export class MetaDataRepository {
  protected bucket = Bucket.validator_metaData;

  private readonly bucketId = getBucketNameByValue(this.bucket);
  private readonly dbReqOpts: DbReqOpts = {bucketId: this.bucketId};

  constructor(protected db: LodestarValidatorDatabaseController) {
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
