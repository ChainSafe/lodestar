import {BulkRepository} from "../repository";
import {AttesterSlashing} from "../../../../types";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class AttesterSlashingRepository extends BulkRepository<AttesterSlashing> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.attesterSlashing, config.types.AttesterSlashing);
  }

}
