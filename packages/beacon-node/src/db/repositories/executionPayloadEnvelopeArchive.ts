import {ContainerType, Type, UnionType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, Db, DbBatch, Repository, encodeKey as encodeDbKey} from "@lodestar/db";
import {Slot, gloas, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

// Lodestar-internal storage types — NOT spec containers, never hashed or put on the wire.
// Kept next to the repository that reads them (see blobSidecarsWrapperSsz for the precedent).

const {
  transactionsRoot: _transactionsRoot,
  withdrawalsRoot: _withdrawalsRoot,
  ...executionPayloadScalarFields
} = ssz.electra.ExecutionPayloadHeader.fields;

/**
 * The execution payload with transactions, withdrawals and blockAccessList dropped, plus the
 * hash_tree_root of the full payload so a reconstruction from EL bodies can be verified with a
 * single check.
 */
export const compactExecutionPayloadSsz = new ContainerType(
  {
    ...executionPayloadScalarFields,
    slotNumber: ssz.Slot, // GLOAS:EIP-7843
    payloadRoot: ssz.Root, // hash_tree_root(ExecutionPayload) of the full payload
  },
  {typeName: "CompactExecutionPayload", jsonCase: "eth2"}
);

export const compactExecutionPayloadEnvelopeSsz = new ContainerType(
  {
    ...ssz.gloas.ExecutionPayloadEnvelope.fields,
    payload: compactExecutionPayloadSsz,
  },
  {typeName: "CompactExecutionPayloadEnvelope", jsonCase: "eth2"}
);

export const signedCompactExecutionPayloadEnvelopeSsz = new ContainerType(
  {
    message: compactExecutionPayloadEnvelopeSsz,
    signature: ssz.BLSSignature,
  },
  {typeName: "SignedCompactExecutionPayloadEnvelope", jsonCase: "eth2"}
);

/**
 * Archive value: a finalized envelope stored either compact (selector 0, default — bodies
 * reconstructed from the EL on read) or in full (selector 1, `--chain.dedupePayloads=false`).
 * Serialized as one selector byte followed by the value, so selector 1 entries can be served as
 * `bytes.subarray(1)` without deserializing.
 */
export const archivedSignedExecutionPayloadEnvelopeSsz = new UnionType(
  [signedCompactExecutionPayloadEnvelopeSsz, ssz.gloas.SignedExecutionPayloadEnvelope],
  {typeName: "ArchivedSignedExecutionPayloadEnvelope"}
);

export type CompactExecutionPayload = ValueOf<typeof compactExecutionPayloadSsz>;
export type CompactExecutionPayloadEnvelope = ValueOf<typeof compactExecutionPayloadEnvelopeSsz>;
export type SignedCompactExecutionPayloadEnvelope = ValueOf<typeof signedCompactExecutionPayloadEnvelopeSsz>;

/** Union selector of `archivedSignedExecutionPayloadEnvelopeSsz` */
export enum ArchivedEnvelopeKind {
  /** `SignedCompactExecutionPayloadEnvelope`, bodies reconstructed from the EL on read (default) */
  Compact = 0,
  /** `SignedExecutionPayloadEnvelope` stored as-is (`--chain.dedupePayloads=false`) */
  Full = 1,
}

/** Discriminated form of the ssz union value, so `selector` narrows `value` */
export type ArchivedEnvelope =
  | {selector: ArchivedEnvelopeKind.Compact; value: SignedCompactExecutionPayloadEnvelope}
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
    const type = archivedSignedExecutionPayloadEnvelopeSsz as Type<ArchivedEnvelope>;
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
