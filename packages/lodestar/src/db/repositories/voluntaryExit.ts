import {phase0, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Db, Bucket, Repository, IDbMetrics} from "@chainsafe/lodestar-db";

export class VoluntaryExitRepository extends Repository<ValidatorIndex, phase0.SignedVoluntaryExit> {
  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    super(config, db, Bucket.phase0_exit, ssz.phase0.SignedVoluntaryExit, metrics);
  }

  getId(value: phase0.SignedVoluntaryExit): ValidatorIndex {
    return value.message.validatorIndex;
  }
}
