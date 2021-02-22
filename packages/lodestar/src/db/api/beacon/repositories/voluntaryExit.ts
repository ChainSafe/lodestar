import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

export class VoluntaryExitRepository extends Repository<ValidatorIndex, phase0.SignedVoluntaryExit> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_exit, config.types.phase0.SignedVoluntaryExit);
  }

  public getId(value: phase0.SignedVoluntaryExit): ValidatorIndex {
    return value.message.validatorIndex;
  }
}
