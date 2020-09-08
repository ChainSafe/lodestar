import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IEth1BlockHeader, Eth1BlockHeaderGenerator} from "../../../../eth1";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class Eth1BlockHeaderRepository extends Repository<number, IEth1BlockHeader> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.eth1Data, Eth1BlockHeaderGenerator(config.types));
  }

  public async deleteOld(upToBlockNumber: number): Promise<void> {
    await this.batchDelete(await this.keys({lt: upToBlockNumber}));
  }
}
