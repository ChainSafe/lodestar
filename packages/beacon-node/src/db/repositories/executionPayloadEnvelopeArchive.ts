import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {ssz, Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

import type {gloas} from "@lodestar/types";

/**
 * Repository for finalized execution payload envelopes.
 * Key: slot (number)
 *
 * Stores finalized payload envelopes for historical queries.
 * Slot-based key enables efficient range queries for backfill and archive.
 */
export class ExecutionPayloadEnvelopeArchiveRepository extends Repository<
  Slot,
  gloas.SignedExecutionPayloadEnvelope
> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelopeArchive;
    super(config, db, bucket, ssz.gloas.SignedExecutionPayloadEnvelope, getBucketNameByValue(bucket));
  }

  /**
   * Extract slot from the envelope message.
   * This is used as the key for archive storage.
   */
  getId(value: gloas.SignedExecutionPayloadEnvelope): Slot {
    return value.message.slot;
  }

  /**
   * Decode slot key from database bytes.
   * Slots are stored as big-endian integers.
   */
  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
