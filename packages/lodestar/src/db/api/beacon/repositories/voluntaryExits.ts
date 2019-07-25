import {FullDatabaseRepository} from "../repository";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {VoluntaryExit} from "../../../../types";

export class VoluntaryExitRepository extends FullDatabaseRepository<VoluntaryExit> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.exit, config.types.VoluntaryExit);
  }

}
