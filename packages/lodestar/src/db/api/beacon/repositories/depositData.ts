import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class DepositDataRepository extends BulkRepository<DepositData> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.depositData, config.types.DepositData);
  }

  public async deleteOld(depositCount: number): Promise<void> {
    await this.deleteMany(Array.from({length: depositCount}, (v, k) => k));
  }
}
