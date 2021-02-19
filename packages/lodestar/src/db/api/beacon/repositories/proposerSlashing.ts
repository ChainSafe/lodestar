import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

export class ProposerSlashingRepository extends Repository<ValidatorIndex, phase0.ProposerSlashing> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.proposerSlashing, config.types.phase0.ProposerSlashing);
  }

  public getId(value: phase0.ProposerSlashing): ValidatorIndex {
    return value.signedHeader1.message.proposerIndex;
  }
}
