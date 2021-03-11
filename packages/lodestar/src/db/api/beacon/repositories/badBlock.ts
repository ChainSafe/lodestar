import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

/**
 * bad block roots
 */
export class BadBlockRepository extends Repository<Uint8Array, boolean> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.index_invalidBlock, config.types.Boolean);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: boolean): Uint8Array {
    throw new Error("Cannot get block root from boolean");
  }

  async put(id: Uint8Array, value = true): Promise<void> {
    await super.put(id, value);
  }
}
