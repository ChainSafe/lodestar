import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

/**
 * bad block roots
 */
export class BadBlockRepository extends Repository<Uint8Array, boolean> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.invalidBlock, config.types.Boolean);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getId(value: boolean): Uint8Array {
    throw new Error("Cannot get block root from boolean");
  }

  public async put(id: Uint8Array, value = true): Promise<void> {
    await super.put(id, value);
  }
}
