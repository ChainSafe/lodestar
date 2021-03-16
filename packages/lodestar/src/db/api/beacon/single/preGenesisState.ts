import {TreeBacked, CompositeType} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket} from "@chainsafe/lodestar-db";

export class PreGenesisState {
  private readonly bucket: Bucket;
  private readonly type: CompositeType<TreeBacked<phase0.BeaconState>>;
  private readonly db: IDatabaseController<Buffer, Buffer>;
  private readonly key: Buffer;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.db = db;
    this.type = (config.types.phase0.BeaconState as unknown) as CompositeType<TreeBacked<phase0.BeaconState>>;
    this.bucket = Bucket.phase0_preGenesisState;
    this.key = Buffer.from(new Uint8Array([this.bucket]));
  }

  async put(value: TreeBacked<phase0.BeaconState>): Promise<void> {
    await this.db.put(this.key, this.type.serialize(value) as Buffer);
  }

  async get(): Promise<TreeBacked<phase0.BeaconState> | null> {
    const value = await this.db.get(this.key);
    return value ? this.type.tree.deserialize(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }
}
