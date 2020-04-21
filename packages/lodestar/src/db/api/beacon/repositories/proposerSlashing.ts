import {ProposerSlashing, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class ProposerSlashingRepository extends BulkRepository<ProposerSlashing> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.proposerSlashing, config.types.ProposerSlashing);
  }

  public getId(value: ProposerSlashing): ValidatorIndex {
    return value.signedHeader1.message.proposerIndex;
  }

}
