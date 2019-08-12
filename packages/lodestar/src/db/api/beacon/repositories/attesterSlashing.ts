import {AttesterSlashing} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class AttesterSlashingRepository extends BulkRepository<AttesterSlashing> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.attesterSlashing, config.types.AttesterSlashing);
  }

}
