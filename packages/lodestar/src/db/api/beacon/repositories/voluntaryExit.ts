import {SignedVoluntaryExit, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class VoluntaryExitRepository extends Repository<ValidatorIndex, SignedVoluntaryExit> {
  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.exit, config.types.SignedVoluntaryExit);
  }

  public getId(value: SignedVoluntaryExit): ValidatorIndex {
    return value.message.validatorIndex;
  }
}
