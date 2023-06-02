import {ValidatorIndex} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {SignedBLSToExecutionChangeVersioned, signedBLSToExecutionChangeVersionedType} from "../../util/types.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class BLSToExecutionChangeRepository extends Repository<ValidatorIndex, SignedBLSToExecutionChangeVersioned> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.capella_blsToExecutionChange;
    super(config, db, bucket, signedBLSToExecutionChangeVersionedType, getBucketNameByValue(bucket));
  }

  getId(value: SignedBLSToExecutionChangeVersioned): ValidatorIndex {
    return value.data.message.validatorIndex;
  }
}
