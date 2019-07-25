import {FullDatabaseRepository} from "../repository";
import {ProposerSlashing} from "../../../../types";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class ProposerSlashingRepository extends FullDatabaseRepository<ProposerSlashing> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.proposerSlashing, config.types.ProposerSlashing);
  }

}
