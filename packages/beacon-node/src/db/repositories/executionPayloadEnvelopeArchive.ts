import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, Db, Repository, encodeKey as encodeDbKey} from "@lodestar/db";
import {Slot, gloas, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * Used to store finalized `SignedCompactExecutionPayloadEnvelope` (payload de-duplicated:
 * transactions/withdrawals reconstructed from the EL on read).
 *
 * Indexed by slot for chronological archival
 */
export class ExecutionPayloadEnvelopeArchiveRepository extends Repository<
  Slot,
  gloas.SignedCompactExecutionPayloadEnvelope
> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelopeArchive;
    super(config, db, bucket, ssz.gloas.SignedCompactExecutionPayloadEnvelope, getBucketNameByValue(bucket));
  }

  /**
   * Id is the slot from the envelope
   */
  getId(value: gloas.SignedCompactExecutionPayloadEnvelope): Slot {
    return value.message.payload.slotNumber;
  }

  encodeKey(id: Slot): Uint8Array {
    return encodeDbKey(this.bucket, id);
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(data.subarray(BUCKET_LENGTH), "be");
  }
}
