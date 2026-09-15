import {Slot, gloas} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {IExecutionEngine} from "../../../execution/index.js";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../../errors/envelopeReconstructionError.js";
import {signedCompactEnvelopeToFull} from "./compactEnvelope.js";

/** engine_getPayloadBodiesByHashV2: ELs MUST support at least 32 hashes per request. */
const MAX_BODIES_REQUEST = 32;

export type SlotEnvelope = {slot: Slot; envelope: gloas.SignedExecutionPayloadEnvelope};
type SlotCompact = {slot: Slot; compact: gloas.SignedCompactExecutionPayloadEnvelope};

/**
 * Stream finalized envelopes over [startSlot, endSlot), rebuilding each full envelope from its
 * archived compact form + EL bodies. Bodies are fetched in batches of MAX_BODIES_REQUEST (32) to
 * bound round-trips (a range request may span up to MAX_REQUEST_PAYLOADS = 128 slots).
 *
 * Slots the EL cannot serve — unknown block hash, or a pruned block access list (EIP-7928 only
 * requires ELs to retain BALs for the weak subjectivity period) — are skipped and warned once per
 * range, matching what Teku does. The by-range spec says peers SHOULD respond ResourceUnavailable
 * in that case; we omit instead, which the by-root spec explicitly allows.
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
  let batch: SlotCompact[] = [];
  let missCount = 0;

  for await (const {key: slot, value: compact} of archive.entriesStream({gte: startSlot, lt: endSlot})) {
    batch.push({slot, compact});
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

/** Reconstruct a single archived envelope (getter path). Returns null if the EL can't serve its bodies. */
export async function reconstructArchivedEnvelope(
  executionEngine: IExecutionEngine,
  compact: gloas.SignedCompactExecutionPayloadEnvelope
): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
  const [reconstructed] = await reconstructBatch(executionEngine, [
    {slot: compact.message.payload.slotNumber, compact},
  ]);
  return reconstructed?.envelope ?? null;
}

/** One EL round-trip for a batch of compact envelopes, reassembling each full envelope. */
async function reconstructBatch(executionEngine: IExecutionEngine, batch: SlotCompact[]): Promise<SlotEnvelope[]> {
  const hashes = batch.map(({compact}) => toRootHex(compact.message.payload.blockHash));

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

  const reconstructed: SlotEnvelope[] = [];
  for (let i = 0; i < batch.length; i++) {
    const {slot, compact} = batch[i];
    const body = bodies[i];
    // EL doesn't have the block, pre-capella shape (no withdrawals), or BAL already pruned → cannot rebuild
    if (body == null || body.withdrawals == null || body.blockAccessList == null) continue;
    reconstructed.push({
      slot,
      envelope: signedCompactEnvelopeToFull(compact, {
        transactions: body.transactions,
        withdrawals: body.withdrawals,
        blockAccessList: body.blockAccessList,
      }),
    });
  }
  return reconstructed;
}
