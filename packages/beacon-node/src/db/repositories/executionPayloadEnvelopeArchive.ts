import {ContainerType, Type, UnionType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, Db, DbBatch, Repository, encodeKey as encodeDbKey} from "@lodestar/db";
import {Slot, gloas, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

// Lodestar-internal storage types, not spec containers

const {
  transactions: _transactions,
  withdrawals: _withdrawals,
  blockAccessList: _blockAccessList,
  ...executionPayloadScalarFields
} = ssz.gloas.ExecutionPayload.fields;

/** ExecutionPayload minus transactions, withdrawals and blockAccessList, plus the full payload's hash_tree_root */
export const compactExecutionPayloadSsz = new ContainerType(
  {
    ...executionPayloadScalarFields,
    payloadRoot: ssz.Root,
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
 * Archive value: compact (selector 0, default) or full (selector 1, `--chain.dedupePayloads=false`).
 * One selector byte then the value, so full entries are servable as `bytes.subarray(1)`.
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

const ARCHIVED_ENVELOPE_SELECTOR_LENGTH = 1;

/** A raw archive value branched on its selector byte, without deserializing the full form */
export type ArchivedEnvelopeBinary =
  | {kind: ArchivedEnvelopeKind.Full; envelopeBytes: Uint8Array}
  | {kind: ArchivedEnvelopeKind.Compact; compact: SignedCompactExecutionPayloadEnvelope};

export function decodeArchivedEnvelopeBinary(bytes: Uint8Array): ArchivedEnvelopeBinary {
  const value = bytes.subarray(ARCHIVED_ENVELOPE_SELECTOR_LENGTH);
  return bytes[0] === ArchivedEnvelopeKind.Full
    ? {kind: ArchivedEnvelopeKind.Full, envelopeBytes: value}
    : {kind: ArchivedEnvelopeKind.Compact, compact: signedCompactExecutionPayloadEnvelopeSsz.deserialize(value)};
}

/** Full envelope bytes as they already are in the hot db, prefixed with the selector byte */
export function encodeArchivedFullEnvelopeBinary(envelopeBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(ARCHIVED_ENVELOPE_SELECTOR_LENGTH + envelopeBytes.length);
  out[0] = ArchivedEnvelopeKind.Full;
  out.set(envelopeBytes, ARCHIVED_ENVELOPE_SELECTOR_LENGTH);
  return out;
}

/**
 * Finalized envelopes, compact or full ({@link ArchivedEnvelopeKind}), indexed by slot
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

  decodeKey(data: Uint8Array): number {
    return bytesToInt(data.subarray(BUCKET_LENGTH), "be");
  }
}
