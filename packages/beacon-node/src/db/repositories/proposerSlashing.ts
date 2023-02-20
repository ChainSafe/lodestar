import {phase0, ssz, ValidatorIndex} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Bucket, Repository} from "@lodestar/db";

export class ProposerSlashingRepository extends Repository<ValidatorIndex, phase0.ProposerSlashing> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.phase0_proposerSlashing, ssz.phase0.ProposerSlashing);
  }

  getId(value: phase0.ProposerSlashing): ValidatorIndex {
    return value.signedHeader1.message.proposerIndex;
  }
}
