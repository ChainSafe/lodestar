import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IEth1Block, Eth1BlockGenerator} from "../../../../eth1/types";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class Eth1BlockRepository extends Repository<number, IEth1Block> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.eth1Block, Eth1BlockGenerator(config.types));
  }

  public async deleteOld(upToBlockNumber: number): Promise<void> {
    await this.batchDelete(await this.keys({lt: upToBlockNumber}));
  }

  public async batchPutValues(blocks: IEth1Block[]): Promise<void> {
    await this.batchPut(
      blocks.map((block) => ({
        key: block.number,
        value: block,
      }))
    );
  }
}
