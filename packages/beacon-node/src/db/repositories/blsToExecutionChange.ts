import {ValidatorIndex} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {Db, Bucket, Repository} from "@lodestar/db";
import {SignedBLSToExecutionChangeVersioned, signedBLSToExecutionChangeVersionedType} from "../../util/types.js";

export class BLSToExecutionChangeRepository extends Repository<ValidatorIndex, SignedBLSToExecutionChangeVersioned> {
  constructor(config: IChainForkConfig, db: Db) {
    super(config, db, Bucket.capella_blsToExecutionChange, signedBLSToExecutionChangeVersionedType);
  }

  getId(value: SignedBLSToExecutionChangeVersioned): ValidatorIndex {
    return value.data.message.validatorIndex;
  }
}
