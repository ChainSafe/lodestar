import {Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {Root, UintNum64} from "@chainsafe/lodestar-types";
import {ssz} from "@chainsafe/lodestar-types";
import {LodestarValidatorDatabaseController} from "../types.js";

const GENESIS_VALIDATORS_ROOT = Buffer.from("GENESIS_VALIDATORS_ROOT");
const GENESIS_TIME = Buffer.from("GENESIS_TIME");

/**
 * Store MetaData of validator.
 */
export class MetaDataRepository {
  protected db: LodestarValidatorDatabaseController;
  protected bucket = Bucket.validator_metaData;

  constructor(opts: IDatabaseApiOptions) {
    this.db = opts.controller;
  }

  async getGenesisValidatorsRoot(): Promise<Root | null> {
    return this.db.get(this.encodeKey(GENESIS_VALIDATORS_ROOT));
  }

  async setGenesisValidatorsRoot(genesisValidatorsRoot: Root): Promise<void> {
    await this.db.put(this.encodeKey(GENESIS_VALIDATORS_ROOT), Buffer.from(genesisValidatorsRoot));
  }

  async getGenesisTime(): Promise<UintNum64 | null> {
    const bytes = await this.db.get(this.encodeKey(GENESIS_TIME));
    return bytes ? ssz.UintNum64.deserialize(bytes) : null;
  }

  async setGenesisTime(genesisTime: UintNum64): Promise<void> {
    await this.db.put(this.encodeKey(GENESIS_TIME), Buffer.from(ssz.UintNum64.serialize(genesisTime)));
  }

  private encodeKey(key: Uint8Array): Uint8Array {
    return encodeKey(this.bucket, key);
  }
}
