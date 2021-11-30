import {Type} from "@chainsafe/ssz";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {Db, Bucket, IDbMetrics} from "@chainsafe/lodestar-db";

export class LatestFinalizedUpdate {
  private readonly bucket = Bucket.altair_latestFinalizedUpdate;
  private readonly key = Buffer.from(new Uint8Array([this.bucket]));
  private readonly type: Type<altair.LightClientUpdate>;
  private readonly db: Db;
  private readonly metrics?: IDbMetrics;

  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    this.db = db;
    this.type = ssz.altair.LightClientUpdate;
    this.metrics = metrics;
  }

  async put(value: altair.LightClientUpdate): Promise<void> {
    this.metrics?.dbWrites.labels({bucket: "altair_latestFinalizedUpdate"}).inc();
    await this.db.put(this.key, this.type.serialize(value) as Uint8Array);
  }

  async get(): Promise<altair.LightClientUpdate | null> {
    this.metrics?.dbReads.labels({bucket: "altair_latestFinalizedUpdate"}).inc();
    const value = await this.db.get(this.key);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
