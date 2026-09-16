import {Slot, gloas} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {ArchivedEnvelope, ArchivedEnvelopeKind} from "../../../db/repositories/index.js";
import {IExecutionEngine} from "../../../execution/index.js";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../../errors/envelopeReconstructionError.js";
import {signedCompactEnvelopeToFull} from "./compactEnvelope.js";

/** engine_getPayloadBodiesByHashV2: ELs MUST support at least 32 hashes per request. */
const MAX_BODIES_REQUEST = 32;

export type SlotEnvelope = {slot: Slot; envelope: gloas.SignedExecutionPayloadEnvelope};
type SlotArchived = {slot: Slot; archived: ArchivedEnvelope};

/**
 * Stream finalized envelopes over [startSlot, endSlot) in slot order. Compact entries (the default)
 * are rebuilt from EL bodies, fetched in batches of MAX_BODIES_REQUEST (32) to bound round-trips (a
 * range request may span up to MAX_REQUEST_PAYLOADS = 128 slots); full entries
 * (`--chain.dedupePayloads=false`) are yielded as-is.
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
): AsyncIterable<SlotEnvelope> {
  const archive = db.executionPayloadEnvelopeArchive;
  let batch: SlotArchived[] = [];
  let missCount = 0;

  for await (const {key: slot, value: archived} of archive.entriesStream({gte: startSlot, lt: endSlot})) {
    batch.push({slot, archived});
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

/** Reconstruct a single compact envelope (getter path). Returns null if the EL can't serve its bodies. */
export async function reconstructArchivedEnvelope(
  executionEngine: IExecutionEngine,
  compact: gloas.SignedCompactExecutionPayloadEnvelope
): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
  const [reconstructed] = await reconstructBatch(executionEngine, [
    {slot: compact.message.payload.slotNumber, archived: {selector: ArchivedEnvelopeKind.Compact, value: compact}},
  ]);
  return reconstructed?.envelope ?? null;
}

/** One EL round-trip for the compact entries of a batch, keeping the batch's slot order. */
async function reconstructBatch(executionEngine: IExecutionEngine, batch: SlotArchived[]): Promise<SlotEnvelope[]> {
  const hashes: string[] = [];
  for (const {archived} of batch) {
    if (archived.selector === ArchivedEnvelopeKind.Compact) {
      hashes.push(toRootHex(archived.value.message.payload.blockHash));
    }
  }

  let bodies: Awaited<ReturnType<IExecutionEngine["getPayloadBodiesByHashV2"]>> = [];
  if (hashes.length > 0) {
    try {
      bodies = await executionEngine.getPayloadBodiesByHashV2(hashes);
    } catch (e) {
      throw new EnvelopeReconstructionError(
        {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE},
        `engine_getPayloadBodiesByHashV2 failed: ${(e as Error).message}`,
        {cause: e}
      );
    }
  }

  const reconstructed: SlotEnvelope[] = [];
  let bodyIdx = 0;
  for (const {slot, archived} of batch) {
    if (archived.selector === ArchivedEnvelopeKind.Full) {
      reconstructed.push({slot, envelope: archived.value});
      continue;
    }
    const body = bodies[bodyIdx++];
    // EL doesn't have the block, pre-capella shape (no withdrawals), or BAL already pruned → cannot rebuild
    if (body == null || body.withdrawals == null || body.blockAccessList == null) continue;
    reconstructed.push({
      slot,
      envelope: signedCompactEnvelopeToFull(archived.value, {
        transactions: body.transactions,
        withdrawals: body.withdrawals,
        blockAccessList: body.blockAccessList,
      }),
    });
  }
  return reconstructed;
}
