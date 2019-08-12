import {ProposerSlashing} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class ProposerSlashingRepository extends BulkRepository<ProposerSlashing> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.proposerSlashing, config.types.ProposerSlashing);
  }

}
