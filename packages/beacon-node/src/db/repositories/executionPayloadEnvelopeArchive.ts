import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, BinaryRepository, Db, DbBatch, encodeKey as encodeDbKey} from "@lodestar/db";
import {Slot, gloas, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * Prefix of a header entry. A full `SignedExecutionPayloadEnvelope` starts with the offset of its
 * variable-size `message` field (4 + 96 = 0x64), so a leading 0x00 byte is unambiguous and full
 * entries can be stored as the hot db bytes, untouched.
 */
const HEADER_ENVELOPE_PREFIX = 0x00;

/** An archive entry as the serving paths need it: full stays bytes, header is deserialized for reconstruction */
export type ArchivedEnvelope =
  | {headerEnvelope: gloas.SignedExecutionPayloadHeaderEnvelope; envelopeBytes?: undefined}
  | {headerEnvelope?: undefined; envelopeBytes: Uint8Array};

export function decodeArchivedEnvelope(bytes: Uint8Array): ArchivedEnvelope {
  return bytes[0] === HEADER_ENVELOPE_PREFIX
    ? {headerEnvelope: ssz.gloas.SignedExecutionPayloadHeaderEnvelope.deserialize(bytes.subarray(1))}
    : {envelopeBytes: bytes};
}

export function encodeArchivedHeaderEnvelope(headerEnvelope: gloas.SignedExecutionPayloadHeaderEnvelope): Uint8Array {
  const value = ssz.gloas.SignedExecutionPayloadHeaderEnvelope.serialize(headerEnvelope);
  const out = new Uint8Array(1 + value.length);
  out[0] = HEADER_ENVELOPE_PREFIX;
  out.set(value, 1);
  return out;
}

/**
 * Finalized envelopes indexed by slot: `SignedExecutionPayloadEnvelope` bytes as-is
 * (`--chain.dedupePayloads=false`, or the block was still optimistic when archived), or a
 * `SignedExecutionPayloadHeaderEnvelope` behind a 0x00 prefix. See {@link decodeArchivedEnvelope}.
 */
export class ExecutionPayloadEnvelopeArchiveRepository extends BinaryRepository<Slot> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelopeArchive;
    super(config, db, bucket, getBucketNameByValue(bucket));
  }

  encodeKey(id: Slot): Uint8Array {
    return encodeDbKey(this.bucket, id);
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(data.subarray(BUCKET_LENGTH), "be");
  }

  /** Archive entries and delete their hot counterparts (`hotKey` pre-encoded) in one atomic batch */
  async batchArchiveAndDeleteHot(
    entries: {slot: Slot; archivedBytes: Uint8Array; hotKey: Uint8Array}[]
  ): Promise<void> {
    const operations: DbBatch<Uint8Array, Uint8Array> = [];
    for (const {slot, archivedBytes, hotKey} of entries) {
      operations.push({type: "put", key: this.encodeKey(slot), value: archivedBytes}, {type: "del", key: hotKey});
    }
    await this.db.batch(operations, this.dbReqOpts);
  }
}
