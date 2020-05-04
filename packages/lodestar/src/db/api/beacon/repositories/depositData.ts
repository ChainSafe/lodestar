import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

/**
 * DepositData indexed by deposit index
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class DepositDataRepository extends Repository<number, DepositData> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.depositData, config.types.DepositData);
  }

  public async deleteOld(depositCount: number): Promise<void> {
    await this.batchDelete(Array.from({length: depositCount}, (_, i) => i));
  }
}
