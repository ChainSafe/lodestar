import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * Store temporary checkpoint states.
 * We should only put/get binary data from this repository, consumer will load it into an existing state ViewDU object.
 */
export class CheckpointStateRepository extends Repository<Uint8Array, BeaconStateAllForks> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const type = ssz.phase0.BeaconState as any;
    const bucket = Bucket.allForks_checkpointState;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  getId(): Uint8Array {
    throw Error("CheckpointStateRepository does not work with value");
  }

  encodeValue(): Uint8Array {
    throw Error("CheckpointStateRepository does not work with value");
  }

  decodeValue(): BeaconStateAllForks {
    throw Error("CheckpointStateRepository does not work with value");
  }
}
