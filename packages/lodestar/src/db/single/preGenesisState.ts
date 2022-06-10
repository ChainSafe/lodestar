import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Db, Bucket} from "@chainsafe/lodestar-db";
import {BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";

export class PreGenesisState {
  private readonly config: IChainForkConfig;
  private readonly bucket: Bucket;
  private readonly db: Db;
  private readonly key: Uint8Array;
  private readonly type: allForks.AllForksSSZTypes["BeaconState"];

  constructor(config: IChainForkConfig, db: Db) {
    this.config = config;
    this.db = db;
    this.bucket = Bucket.phase0_preGenesisState;
    this.key = new Uint8Array([this.bucket]);
    this.type = this.config.getForkTypes(GENESIS_SLOT).BeaconState;
  }

  async put(value: BeaconStateAllForks): Promise<void> {
    await this.db.put(this.key, value.serialize());
  }

  async get(): Promise<BeaconStateAllForks | null> {
    const value = await this.db.get(this.key);
    return value ? this.type.deserializeToViewDU(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
