import {ChainForkConfig} from "@lodestar/config";
import {Slot, gloas} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {IExecutionEngine} from "../../../execution/index.js";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../../errors/envelopeReconstructionError.js";
import {signedCompactEnvelopeToFull} from "./compactEnvelope.js";

/** engine_getPayloadBodiesByHashV1: ELs MUST support at least 32 hashes per request (Shanghai). */
const MAX_BODIES_REQUEST = 32;

export type SlotEnvelope = {slot: Slot; envelope: gloas.SignedExecutionPayloadEnvelope};
type SlotCompact = {slot: Slot; compact: gloas.SignedCompactExecutionPayloadEnvelope};

/**
 * Stream finalized envelopes over [startSlot, endSlot), rebuilding each full envelope from its
 * archived compact form + EL bodies. Bodies are fetched in batches of MAX_BODIES_REQUEST (32) to
 * bound round-trips (a range request may span up to MAX_REQUEST_PAYLOADS = 128 slots). Slots the EL
 * cannot serve are skipped and warned once for the whole range.
 *
 * Throws {@link EnvelopeReconstructionError}: ENGINE_UNAVAILABLE if the EL call fails (transient),
 * or *_ROOT_MISMATCH if the EL bodies do not match the archived roots (local inconsistency). Either
 * may surface after some envelopes have already been yielded.
 */
export async function* reconstructArchivedEnvelopesByRange(
  db: IBeaconDb,
  executionEngine: IExecutionEngine,
  config: ChainForkConfig,
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
      const reconstructed = await reconstructBatch(executionEngine, config, batch);
      missCount += batch.length - reconstructed.length;
      yield* reconstructed;
      batch = [];
    }
  }
  if (batch.length > 0) {
    const reconstructed = await reconstructBatch(executionEngine, config, batch);
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
  config: ChainForkConfig,
  compact: gloas.SignedCompactExecutionPayloadEnvelope
): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
  const [reconstructed] = await reconstructBatch(executionEngine, config, [
    {slot: compact.message.payload.slotNumber, compact},
  ]);
  return reconstructed?.envelope ?? null;
}

/**
 * One EL round-trip for a batch of compact envelopes, reassembling each full envelope. Assumes a
 * single fork per batch (all archived envelopes fall in the same fork within the serving window, and
 * the bodies endpoint is Capella-stable).
 */
async function reconstructBatch(
  executionEngine: IExecutionEngine,
  config: ChainForkConfig,
  batch: SlotCompact[]
): Promise<SlotEnvelope[]> {
  const fork = config.getForkName(batch[0].compact.message.payload.slotNumber);
  const hashes = batch.map(({compact}) => toRootHex(compact.message.payload.blockHash));

  let bodies: Awaited<ReturnType<IExecutionEngine["getPayloadBodiesByHash"]>>;
  try {
    bodies = await executionEngine.getPayloadBodiesByHash(fork, hashes);
  } catch (e) {
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE},
      `engine_getPayloadBodiesByHash failed: ${(e as Error).message}`,
      {cause: e}
    );
  }

  const reconstructed: SlotEnvelope[] = [];
  for (let i = 0; i < batch.length; i++) {
    const {slot, compact} = batch[i];
    const body = bodies[i];
    // EL doesn't have the block, or returned a pre-capella shape (no withdrawals) → cannot rebuild
    if (body == null || body.withdrawals == null) continue;
    reconstructed.push({slot, envelope: signedCompactEnvelopeToFull(compact, body.transactions, body.withdrawals)});
  }
  return reconstructed;
}
