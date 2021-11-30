import {TreeBacked, ContainerType} from "@chainsafe/ssz";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Db, Bucket, IDbMetrics} from "@chainsafe/lodestar-db";

export class PreGenesisState {
  private readonly config: IChainForkConfig;
  private readonly bucket: Bucket;
  private readonly db: Db;
  private readonly key: Buffer;
  private readonly metrics?: IDbMetrics;

  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    this.config = config;
    this.db = db;
    this.bucket = Bucket.phase0_preGenesisState;
    this.key = Buffer.from(new Uint8Array([this.bucket]));
    this.metrics = metrics;
  }

  async put(value: TreeBacked<allForks.BeaconState>): Promise<void> {
    this.metrics?.dbWrites.labels({bucket: "phase0_preGenesisState"}).inc();
    await this.db.put(this.key, this.type().serialize(value) as Buffer);
  }

  async get(): Promise<TreeBacked<allForks.BeaconState> | null> {
    this.metrics?.dbReads.labels({bucket: "phase0_preGenesisState"}).inc();
    const value = await this.db.get(this.key);
    return value ? this.type().createTreeBackedFromBytes(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }

  private type(): ContainerType<allForks.BeaconState> {
    return this.config.getForkTypes(GENESIS_SLOT).BeaconState;
  }
}
