import {capella, ssz, ValidatorIndex} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {Db, Bucket, Repository} from "@lodestar/db";

export class BLSToExecutionChangeRepository extends Repository<ValidatorIndex, capella.SignedBLSToExecutionChange> {
  constructor(config: IChainForkConfig, db: Db) {
    super(config, db, Bucket.capella_blsToExecutionChange, ssz.capella.SignedBLSToExecutionChange);
  }

  getId(value: capella.SignedBLSToExecutionChange): ValidatorIndex {
    return value.message.validatorIndex;
  }
}
