import {Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {Root} from "@chainsafe/lodestar-types";
import {LodestarValidatorDatabaseController} from "../types";

const GENESIS_VALIDATORS_ROOT = Buffer.from("GENESIS_VALIDATORS_ROOT");

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
    await this.db.put(
      this.encodeKey(GENESIS_VALIDATORS_ROOT),
      Buffer.from(genesisValidatorsRoot.valueOf() as Uint8Array)
    );
  }

  private encodeKey(key: Buffer): Buffer {
    return encodeKey(this.bucket, key);
  }
}
