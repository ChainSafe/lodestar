import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {CompactExecutionPayloadEnvelope} from "./executionPayloadEnvelopeArchiveTypes.js";

export class CompactExecutionPayloadEnvelopeArchiveRepository extends Repository<
  Slot,
  CompactExecutionPayloadEnvelope
> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_compactExecutionPayloadEnvelopeArchive;
    super(config, db, bucket, CompactExecutionPayloadEnvelope, getBucketNameByValue(bucket));
  }

  getId(value: CompactExecutionPayloadEnvelope): Slot {
    return value.message.payload.slotNumber;
  }

  decodeKey(data: Uint8Array): Slot {
    return bytesToInt(data.subarray(BUCKET_LENGTH), "be");
  }
}
