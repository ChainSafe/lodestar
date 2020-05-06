import {Eth1Data} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class Eth1DataRepository extends Repository<number, Eth1Data> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.eth1Data, config.types.Eth1Data);
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getId(value: Eth1Data): number {
    throw new Error("Unable to create timestamp from block hash");
  }

  public async deleteOld(timestamp: number): Promise<void> {
    await this.batchDelete(await this.keys({lt: timestamp}));
  }
}
