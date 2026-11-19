import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Root, gloas, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

type BlockRoot = Root;

/**
 * Used to store unfinalized `SignedExecutionPayloadEnvelope`
 *
 * Indexed by beacon block root (root of the beacon block that contains the bid)
 */
export class ExecutionPayloadEnvelopeRepository extends Repository<BlockRoot, gloas.SignedExecutionPayloadEnvelope> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelope;
    super(config, db, bucket, ssz.gloas.SignedExecutionPayloadEnvelope, getBucketNameByValue(bucket));
  }

  /**
   * Id is the beacon block root (not execution payload hash)
   * This allows correlation with the block that contains the bid
   */
  getId(value: gloas.SignedExecutionPayloadEnvelope): BlockRoot {
    return value.message.beaconBlockRoot;
  }
}
