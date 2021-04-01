import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

export class ProposerSlashingRepository extends Repository<ValidatorIndex, phase0.ProposerSlashing> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_proposerSlashing, config.types.phase0.ProposerSlashing);
  }

  getId(value: phase0.ProposerSlashing): ValidatorIndex {
    return value.signedHeader1.message.proposerIndex;
  }
}
