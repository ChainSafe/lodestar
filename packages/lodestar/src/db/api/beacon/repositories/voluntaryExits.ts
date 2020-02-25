import {SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class VoluntaryExitRepository extends BulkRepository<SignedVoluntaryExit> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.exit, config.types.SignedVoluntaryExit);
  }

}
