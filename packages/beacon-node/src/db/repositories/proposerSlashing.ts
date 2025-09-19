import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {ValidatorIndex, phase0, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class ProposerSlashingRepository extends Repository<ValidatorIndex, phase0.ProposerSlashing> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.phase0_proposerSlashing;
    super(config, db, bucket, ssz.phase0.ProposerSlashing, getBucketNameByValue(bucket));
  }

  getId(value: phase0.ProposerSlashing): ValidatorIndex {
    return value.signedHeader1.message.proposerIndex;
  }
}
