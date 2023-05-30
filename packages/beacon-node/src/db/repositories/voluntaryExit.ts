import {phase0, ssz, ValidatorIndex} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class VoluntaryExitRepository extends Repository<ValidatorIndex, phase0.SignedVoluntaryExit> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.phase0_exit;
    super(config, db, bucket, ssz.phase0.SignedVoluntaryExit, getBucketNameByValue(bucket));
  }

  getId(value: phase0.SignedVoluntaryExit): ValidatorIndex {
    return value.message.validatorIndex;
  }
}
