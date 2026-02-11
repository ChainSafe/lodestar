import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

import type {gloas} from "@lodestar/types";

/**
 * Repository for unfinalized execution payload envelopes.
 * Key: beaconBlockRoot (Uint8Array)
 *
 * Stores payload envelopes received via gossip or sync for Gloas blocks.
 * Pruned on finalization.
 */
export class ExecutionPayloadEnvelopeRepository extends Repository<
  Uint8Array,
  gloas.SignedExecutionPayloadEnvelope
> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelope;
    super(config, db, bucket, ssz.gloas.SignedExecutionPayloadEnvelope, getBucketNameByValue(bucket));
  }

  /**
   * Extract the beacon block root from the envelope message.
   * This is used as the key for hot storage.
   */
  getId(value: gloas.SignedExecutionPayloadEnvelope): Uint8Array {
    return value.message.beaconBlockRoot;
  }
}
