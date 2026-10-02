import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Root, gloas, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/** Execution requests keyed explicitly by beacon block root (not `getId`); pruned on finalization. */
export class ExecutionRequestsRepository extends Repository<Root, gloas.ExecutionRequests> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionRequests;
    super(config, db, bucket, ssz.gloas.ExecutionRequests, getBucketNameByValue(bucket));
  }
}
