import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDepositEvent, DepositEventGenerator} from "../../../../eth1";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

/**
 * DepositData indexed by deposit index
 *
 * ### TODO: Are deposits meant to be included via gossip? They are not
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class DepositEventRepository extends Repository<number, IDepositEvent> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.depositData, DepositEventGenerator(config.types));
  }

  public async deleteOld(depositCount: number): Promise<void> {
    const firstDepositIndex = await this.firstKey();
    if (firstDepositIndex !== 0 && !firstDepositIndex) {
      return;
    }
    await this.batchDelete(Array.from({length: depositCount - firstDepositIndex}, (_, i) => i + firstDepositIndex));
  }

  public async getRange(fromIndex: number, toIndex: number): Promise<IDepositEvent[]> {
    // ### TODO: Range is inclusive or exclusive?
    const depositDatas = await this.values({gt: fromIndex, lt: toIndex});

    // Make sure all expected indexed are present
    // ### TODO: Level does not guarantee this keys to exist?
    // ### TODO: This repository guarantees that there are only sequential deposits without gaps?
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
