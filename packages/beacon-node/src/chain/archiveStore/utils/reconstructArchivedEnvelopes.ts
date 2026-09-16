import {Slot, gloas, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {
  ARCHIVED_ENVELOPE_SELECTOR_LENGTH,
  ArchivedEnvelopeKind,
  SignedCompactExecutionPayloadEnvelope,
  signedCompactExecutionPayloadEnvelopeSsz,
} from "../../../db/repositories/index.js";
import {IExecutionEngine} from "../../../execution/index.js";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../../errors/envelopeReconstructionError.js";
import {signedCompactEnvelopeToFull} from "./compactEnvelope.js";

/** engine_getPayloadBodiesByHashV2: ELs MUST support at least 32 hashes per request. */
const MAX_BODIES_REQUEST = 32;

/** A finalized envelope ready to serve: the serialized `SignedExecutionPayloadEnvelope` bytes */
export type SlotEnvelopeBytes = {slot: Slot; envelopeBytes: Uint8Array};

/** A range entry read raw from the archive: full ones already hold their servable bytes */
type RangeEntry =
  | {slot: Slot; kind: ArchivedEnvelopeKind.Full; envelopeBytes: Uint8Array}
  | {slot: Slot; kind: ArchivedEnvelopeKind.Compact; compact: SignedCompactExecutionPayloadEnvelope};

/**
 * Stream finalized envelopes over [startSlot, endSlot) in slot order, as serialized bytes. Entries
 * are read raw and branched on the union selector byte: full entries (`--chain.dedupePayloads=false`)
 * are yielded as `bytes.subarray(1)` without deserializing; compact entries (~1 KB, the default) are
 * deserialized, rebuilt from EL bodies fetched in batches of MAX_BODIES_REQUEST (32) to bound
 * round-trips (a range request may span up to MAX_REQUEST_PAYLOADS = 128 slots), and re-serialized.
 *
 * Slots the EL cannot serve — unknown block hash, or a pruned block access list (EIP-7928 only
 * requires ELs to retain BALs for the weak subjectivity period) — are skipped and warned once per
 * range, matching what Teku does.
 *
 * Throws {@link EnvelopeReconstructionError}: ENGINE_UNAVAILABLE if the EL call fails (transient),
 * or PAYLOAD_ROOT_MISMATCH if the EL bodies do not hash to the archived payload root (local
 * inconsistency). Either may surface after some envelopes have already been yielded.
 */
export async function* reconstructArchivedEnvelopesByRange(
  db: IBeaconDb,
  executionEngine: IExecutionEngine,
  logger: Logger,
  startSlot: Slot,
  endSlot: Slot
): AsyncIterable<SlotEnvelopeBytes> {
  const archive = db.executionPayloadEnvelopeArchive;
  let batch: RangeEntry[] = [];
  let missCount = 0;

  for await (const {key, value: bytes} of archive.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
    const slot = archive.decodeKey(key);
    const value = bytes.subarray(ARCHIVED_ENVELOPE_SELECTOR_LENGTH);
    if (bytes[0] === ArchivedEnvelopeKind.Full) {
      batch.push({slot, kind: ArchivedEnvelopeKind.Full, envelopeBytes: value});
    } else {
      batch.push({
        slot,
        kind: ArchivedEnvelopeKind.Compact,
        compact: signedCompactExecutionPayloadEnvelopeSsz.deserialize(value),
      });
    }
    if (batch.length === MAX_BODIES_REQUEST) {
      const reconstructed = await reconstructBatch(executionEngine, batch);
      missCount += batch.length - reconstructed.length;
      yield* reconstructed;
      batch = [];
    }
  }
  if (batch.length > 0) {
    const reconstructed = await reconstructBatch(executionEngine, batch);
    missCount += batch.length - reconstructed.length;
    yield* reconstructed;
  }

  if (missCount > 0) {
    logger.warn("Could not reconstruct some archived envelopes, EL bodies unavailable in range", {
      count: missCount,
      startSlot,
      endSlot,
    });
  }
}

/**
 * Reconstruct compact envelopes from EL bodies, in batches of MAX_BODIES_REQUEST. The result is
 * aligned with the input: `null` where the EL cannot serve that envelope's bodies.
 */
export async function reconstructArchivedEnvelopes(
  executionEngine: IExecutionEngine,
  compacts: SignedCompactExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | null)[]> {
  const out: (gloas.SignedExecutionPayloadEnvelope | null)[] = [];
  for (let i = 0; i < compacts.length; i += MAX_BODIES_REQUEST) {
    out.push(...(await rebuildCompacts(executionEngine, compacts.slice(i, i + MAX_BODIES_REQUEST))));
  }
  return out;
}

/** Reconstruct a single compact envelope (getter path). Returns null if the EL can't serve its bodies. */
export async function reconstructArchivedEnvelope(
  executionEngine: IExecutionEngine,
  compact: SignedCompactExecutionPayloadEnvelope
): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
  const [reconstructed] = await reconstructArchivedEnvelopes(executionEngine, [compact]);
  return reconstructed ?? null;
}

/**
 * One EL round-trip for up to MAX_BODIES_REQUEST compact envelopes. Aligned with the input; `null`
 * where the EL doesn't have the block, returned a pre-capella shape (no withdrawals), or has already
 * pruned the block access list.
 */
async function rebuildCompacts(
  executionEngine: IExecutionEngine,
  compacts: SignedCompactExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | null)[]> {
  if (compacts.length === 0) return [];
  const hashes = compacts.map((compact) => toRootHex(compact.message.payload.blockHash));

  let bodies: Awaited<ReturnType<IExecutionEngine["getPayloadBodiesByHashV2"]>>;
  try {
    bodies = await executionEngine.getPayloadBodiesByHashV2(hashes);
  } catch (e) {
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE},
      `engine_getPayloadBodiesByHashV2 failed: ${(e as Error).message}`,
      {cause: e}
    );
  }

  return compacts.map((compact, i) => {
    const body = bodies[i];
    if (body == null || body.withdrawals == null || body.blockAccessList == null) return null;
    return signedCompactEnvelopeToFull(compact, {
      transactions: body.transactions,
      withdrawals: body.withdrawals,
      blockAccessList: body.blockAccessList,
    });
  });
}

/** Rebuild the compact entries of a range batch in one EL round-trip, keeping the batch's slot order. */
async function reconstructBatch(executionEngine: IExecutionEngine, batch: RangeEntry[]): Promise<SlotEnvelopeBytes[]> {
  const compacts: SignedCompactExecutionPayloadEnvelope[] = [];
  for (const entry of batch) {
    if (entry.kind === ArchivedEnvelopeKind.Compact) compacts.push(entry.compact);
  }
  const rebuilt = await rebuildCompacts(executionEngine, compacts);

  const reconstructed: SlotEnvelopeBytes[] = [];
  let compactIdx = 0;
  for (const entry of batch) {
    if (entry.kind === ArchivedEnvelopeKind.Full) {
      reconstructed.push({slot: entry.slot, envelopeBytes: entry.envelopeBytes});
      continue;
    }
    const envelope = rebuilt[compactIdx++];
    if (envelope !== null) {
      reconstructed.push({
        slot: entry.slot,
        envelopeBytes: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
      });
    }
  }
  return reconstructed;
}
