import {ChainForkConfig} from "@lodestar/config";
import {BinaryRepository, Db} from "@lodestar/db";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * Store temporary checkpoint states.
 * We should only put/get binary data from this repository, consumer will load it into an existing state ViewDU object.
 */
export class CheckpointStateRepository extends BinaryRepository<Uint8Array> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_checkpointState;

    super(config, db, bucket, getBucketNameByValue(bucket));
  }
}
