import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDepositEvent, DepositEventGenerator} from "../../../../eth1/types";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

/**
 * DepositEvent indexed by deposit index
 */
export class DepositEventRepository extends Repository<number, IDepositEvent> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.depositEvent, DepositEventGenerator(config.types));
  }

  public async deleteOld(depositCount: number): Promise<void> {
    const firstDepositIndex = await this.firstKey();
    if (firstDepositIndex !== 0 && !firstDepositIndex) {
      return;
    }
    await this.batchDelete(Array.from({length: depositCount - firstDepositIndex}, (_, i) => i + firstDepositIndex));
  }

  /**
   * Returns deposit events in DB. Range is inclusive
   */
  public async getRange(fromIndex: number, toIndex: number): Promise<IDepositEvent[]> {
    const depositDatas = await this.values({gte: fromIndex, lte: toIndex});

    // DB may not return any deposits matching the query above
    const expectedLength = toIndex - fromIndex;
    if (depositDatas.length < expectedLength) {
      throw Error("Not enough deposits in DB");
    }
    if (depositDatas.length > expectedLength) {
      throw Error("Too many deposits returned by DB");
    }

    return depositDatas;
  }
}
