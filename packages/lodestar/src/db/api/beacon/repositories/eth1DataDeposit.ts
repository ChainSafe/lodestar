import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IEth1DataDeposit, Eth1DataDepositGenerator} from "../../../../eth1/types";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class Eth1DataDepositRepository extends Repository<number, IEth1DataDeposit> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.eth1DataDeposit, Eth1DataDepositGenerator(config.types));
  }

  public async deleteOld(upToBlockNumber: number): Promise<void> {
    await this.batchDelete(await this.keys({lt: upToBlockNumber}));
  }

  public async batchPutValues(values: IEth1DataDeposit[]): Promise<void> {
    await this.batchPut(
      values.map((value) => ({
        key: value.blockNumber,
        value,
      }))
    );
  }
}
