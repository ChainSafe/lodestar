import {Type} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, Db, DbBatch, Repository, encodeKey as encodeDbKey} from "@lodestar/db";
import {Slot, gloas, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/** Union selector of `ssz.gloas.ArchivedSignedExecutionPayloadEnvelope` */
export enum ArchivedEnvelopeKind {
  /** `SignedCompactExecutionPayloadEnvelope`, bodies reconstructed from the EL on read (default) */
  Compact = 0,
  /** `SignedExecutionPayloadEnvelope` stored as-is (`--chain.dedupePayloads=false`) */
  Full = 1,
}

/** Discriminated form of the ssz union value, so `selector` narrows `value` */
export type ArchivedEnvelope =
  | {selector: ArchivedEnvelopeKind.Compact; value: gloas.SignedCompactExecutionPayloadEnvelope}
  | {selector: ArchivedEnvelopeKind.Full; value: gloas.SignedExecutionPayloadEnvelope};

/** Byte length of the union selector that prefixes the serialized value */
export const ARCHIVED_ENVELOPE_SELECTOR_LENGTH = 1;

/**
 * Used to store finalized envelopes, either compact (payload de-duplicated: transactions, withdrawals
 * and block access list reconstructed from the EL on read) or in full, see {@link ArchivedEnvelopeKind}.
 *
 * Indexed by slot for chronological archival
 */
export class ExecutionPayloadEnvelopeArchiveRepository extends Repository<Slot, ArchivedEnvelope> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelopeArchive;
    // ssz types a union value as {selector: number; value: A | B}; narrow it to the discriminated form
    const type = ssz.gloas.ArchivedSignedExecutionPayloadEnvelope as Type<ArchivedEnvelope>;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  /**
   * Id is the slot from the envelope
   */
  getId(value: ArchivedEnvelope): Slot {
    return value.value.message.payload.slotNumber;
  }

  encodeKey(id: Slot): Uint8Array {
    return encodeDbKey(this.bucket, id);
  }

  /**
   * Archive entries and delete their hot counterparts in one atomic db batch, so a crash mid-migration
   * cannot leave an envelope archived-but-not-deleted or deleted-but-not-archived. `hotKey` is the
   * already-encoded key of the hot `executionPayloadEnvelope` entry (the batch spans both buckets).
   */
  async batchArchiveAndDeleteHot(
    entries: {slot: Slot; archived: ArchivedEnvelope; hotKey: Uint8Array}[]
  ): Promise<void> {
    const operations: DbBatch<Uint8Array, Uint8Array> = [];
    for (const {slot, archived, hotKey} of entries) {
      operations.push(
        {type: "put", key: this.encodeKey(slot), value: this.encodeValue(archived)},
        {type: "del", key: hotKey}
      );
    }
    await this.db.batch(operations, this.dbReqOpts);
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(data.subarray(BUCKET_LENGTH), "be");
  }
}
