import {FullDatabaseRepository} from "../repository";
import {Transfer} from "../../../../types";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class TransfersRepository extends FullDatabaseRepository<Transfer> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.transfer, config.types.Transfer);
  }

}
