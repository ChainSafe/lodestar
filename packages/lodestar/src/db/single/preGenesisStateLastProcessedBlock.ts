import {UintNumberType} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Db, Bucket, IDbMetrics} from "@chainsafe/lodestar-db";

export class PreGenesisStateLastProcessedBlock {
  private readonly bucket: Bucket;
  private readonly type: UintNumberType;
  private readonly db: Db;
  private readonly key: Uint8Array;
  private readonly metrics?: IDbMetrics;

  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    this.db = db;
    this.type = ssz.UintNum64;
    this.bucket = Bucket.phase0_preGenesisStateLastProcessedBlock;
    this.key = new Uint8Array([this.bucket]);
    this.metrics = metrics;
  }

  async put(value: number): Promise<void> {
    this.metrics?.dbWrites.labels({bucket: "phase0_preGenesisStateLastProcessedBlock"}).inc();
    await this.db.put(this.key, this.type.serialize(value));
  }

  async get(): Promise<number | null> {
    this.metrics?.dbReads.labels({bucket: "phase0_preGenesisStateLastProcessedBlock"}).inc();
    const value = await this.db.get(this.key);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
