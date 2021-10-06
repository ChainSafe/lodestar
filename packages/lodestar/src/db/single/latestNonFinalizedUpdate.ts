import {Type} from "@chainsafe/ssz";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {IDatabaseController, Bucket, IDbMetrics} from "@chainsafe/lodestar-db";

export class LatestNonFinalizedUpdate {
  private readonly bucket = Bucket.altair_latestNonFinalizedUpdate;
  private readonly key = Buffer.from(new Uint8Array([this.bucket]));
  private readonly type: Type<altair.LightClientUpdateLatest>;
  private readonly db: IDatabaseController<Buffer, Buffer>;
  private readonly metrics?: IDbMetrics;

  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    this.db = db;
    this.type = ssz.altair.LightClientUpdateLatest;
    this.metrics = metrics;
  }

  async put(value: altair.LightClientUpdateLatest): Promise<void> {
    this.metrics?.dbWrites.labels({bucket: "altair_latestNonFinalizedUpdate"}).inc();
    await this.db.put(this.key, this.type.serialize(value) as Buffer);
  }

  async get(): Promise<altair.LightClientUpdateLatest | null> {
    this.metrics?.dbReads.labels({bucket: "altair_latestNonFinalizedUpdate"}).inc();
    const value = await this.db.get(this.key);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
