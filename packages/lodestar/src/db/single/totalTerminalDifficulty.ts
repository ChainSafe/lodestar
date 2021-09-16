import {Type} from "@chainsafe/ssz";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {IDatabaseController, Bucket, IDbMetrics} from "@chainsafe/lodestar-db";

export class TotalTerminalDifficulty {
  private readonly bucket = Bucket.merge_totalTerminalDifficulty;
  private readonly key = Buffer.from(new Uint8Array([this.bucket]));
  private readonly type: Type<bigint>;
  private readonly db: IDatabaseController<Buffer, Buffer>;
  private readonly metrics?: IDbMetrics;

  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    this.db = db;
    this.type = ssz.Uint256;
    this.metrics = metrics;
  }

  async put(value: bigint): Promise<void> {
    this.metrics?.dbWrites.labels({bucket: "merge_totalTerminalDifficulty"}).inc();
    await this.db.put(this.key, this.type.serialize(value) as Buffer);
  }

  async get(): Promise<bigint | null> {
    this.metrics?.dbReads.labels({bucket: "merge_totalTerminalDifficulty"}).inc();
    const value = await this.db.get(this.key);
    return value ? this.type.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
