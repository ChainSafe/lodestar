import {TreeBacked, ContainerType} from "@chainsafe/ssz";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket} from "@chainsafe/lodestar-db";

export class PreGenesisState {
  private readonly config: IBeaconConfig;
  private readonly bucket: Bucket;
  private readonly db: IDatabaseController<Buffer, Buffer>;
  private readonly key: Buffer;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.config = config;
    this.db = db;
    this.bucket = Bucket.phase0_preGenesisState as Bucket;
    this.key = Buffer.from(new Uint8Array([this.bucket]));
  }

  async put(value: TreeBacked<allForks.BeaconState>): Promise<void> {
    await this.db.put(this.key, this.type().serialize(value) as Buffer);
  }

  async get(): Promise<TreeBacked<allForks.BeaconState> | null> {
    const value = await this.db.get(this.key);
    return value ? this.type().createTreeBackedFromBytes(value) : null;
  }

  async delete(): Promise<void> {
    await this.db.delete(this.key);
  }

  private type(): ContainerType<allForks.BeaconState> {
    return this.config.getTypes(GENESIS_SLOT).BeaconState;
  }
}
