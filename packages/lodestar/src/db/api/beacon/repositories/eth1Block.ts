import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IEth1Block, Eth1BlockGenerator} from "../../../../eth1";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class Eth1BlockRepository extends Repository<number, IEth1Block> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.eth1Data, Eth1BlockGenerator(config.types));
  }

  public async deleteOld(upToBlockNumber: number): Promise<void> {
    await this.batchDelete(await this.keys({lt: upToBlockNumber}));
  }
}
