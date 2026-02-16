import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot, gloas, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * ExecutionPayloadEnvelopeArchiveRepository
 * Used to store finalized SignedExecutionPayloadEnvelope
 *
 * Indexed by slot for chronological archival
 */
export class ExecutionPayloadEnvelopeArchiveRepository extends Repository<Slot, gloas.SignedExecutionPayloadEnvelope> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelopeArchive;
    super(config, db, bucket, ssz.gloas.SignedExecutionPayloadEnvelope, getBucketNameByValue(bucket));
  }

  /**
   * Id is the slot from the envelope
   */
  getId(value: gloas.SignedExecutionPayloadEnvelope): Slot {
    return value.message.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
