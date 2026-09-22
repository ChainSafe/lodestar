import {Slot, gloas, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../chain/errors/envelopeReconstructionError.js";
import {IBeaconDb} from "../db/index.js";
import {ArchivedEnvelopeBinary, ArchivedEnvelopeKind, decodeArchivedEnvelopeBinary} from "../db/repositories/index.js";
import {IExecutionEngine} from "../execution/index.js";
import {signedBlindedEnvelopeToFull} from "./blindedEnvelope.js";

/** engine_getPayloadBodiesByHashV2: ELs MUST support at least 32 hashes per request. */
const MAX_BODIES_REQUEST = 32;

export type SlotEnvelopeBytes = {slot: Slot; envelopeBytes: Uint8Array};

type RangeEntry = ArchivedEnvelopeBinary & {slot: Slot};

/** What a payload root mismatch means on a given serving path */
export type ReconstructMismatchPolicy = "throw" | "omit";

export type RebuildMiss =
  /** EL does not have the block, or has pruned its block access list */
  | {slot: Slot; reason: "unavailable"}
  /** An EL body does not hash to its stored root (local inconsistency) */
  | {slot: Slot; reason: "mismatch"; error: EnvelopeReconstructionError};

/**
 * Stream finalized envelopes over [startSlot, endSlot) as serialized bytes. Full entries are served
 * as `bytes.subarray(1)` without deserializing; blinded ones are rebuilt from EL bodies, 32 per
 * round-trip. Every blinded entry is attempted regardless of age: the spec requires serving
 * MIN_EPOCHS_FOR_BLOCK_REQUESTS and allows more, and how much more is decided by the EL's block
 * access list retention.
 *
 * The by-range spec inherits BeaconBlocksByRange v2 semantics: consecutive, MAY be short. A hole
 * looks like a lying peer to one that already holds the blocks, so the stream ends at the first
 * entry that cannot be served (EL miss, or payload root mismatch, which is logged at error but to
 * the peer is simply missing) by throwing {@link EnvelopeReconstructionError} RANGE_UNSERVABLE with
 * that slot; everything yielded before it is still a valid response.
 *
 * Also throws ENGINE_UNAVAILABLE if the EL call itself fails. Either may surface after some
 * envelopes were already yielded.
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

  for await (const {key, value: bytes} of archive.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
    batch.push({slot: archive.decodeKey(key), ...decodeArchivedEnvelopeBinary(bytes)});
    if (batch.length === MAX_BODIES_REQUEST) {
      yield* reconstructBatch(executionEngine, logger, batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield* reconstructBatch(executionEngine, logger, batch);
  }
}

/**
 * Rebuild a range batch, yielding what precedes the first unservable entry before throwing
 * RANGE_UNSERVABLE for it
 */
async function* reconstructBatch(
  executionEngine: IExecutionEngine,
  logger: Logger,
  batch: RangeEntry[]
): AsyncIterable<SlotEnvelopeBytes> {
  const blindeds: gloas.SignedBlindedExecutionPayloadEnvelope[] = [];
  for (const entry of batch) {
    if (entry.kind === ArchivedEnvelopeKind.Blinded) blindeds.push(entry.blinded);
  }
  const rebuilt = await reconstructEnvelopesBatch(executionEngine, blindeds);

  let blindedIdx = 0;
  for (const entry of batch) {
    if (entry.kind === ArchivedEnvelopeKind.Full) {
      yield {slot: entry.slot, envelopeBytes: entry.envelopeBytes};
      continue;
    }
    const result = rebuilt[blindedIdx++];
    if (isRebuildMiss(result)) {
      // Peer-triggered, so debug: a persistent local mismatch would otherwise log on every request
      if (result.reason === "mismatch") {
        logger.debug("Archived envelope failed body root check against EL bodies", {slot: entry.slot}, result.error);
      } else {
        logger.debug("EL cannot serve bodies for archived envelope, ending range", {slot: entry.slot});
      }
      throw new EnvelopeReconstructionError(
        {code: EnvelopeReconstructionErrorCode.RANGE_UNSERVABLE, slot: entry.slot},
        `archived envelope range unservable from slot=${entry.slot}`
      );
    }
    yield {slot: entry.slot, envelopeBytes: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(result)};
  }
}

/**
 * Rebuild blinded envelopes from EL bodies, 32 per round-trip. Aligned with the input, with a
 * {@link RebuildMiss} where the envelope could not be rebuilt; the caller decides what a miss means
 * on its path. Throws ENGINE_UNAVAILABLE only.
 */
export async function reconstructArchivedEnvelopes(
  executionEngine: IExecutionEngine,
  blindeds: gloas.SignedBlindedExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[]> {
  const out: (gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[] = [];
  for (let i = 0; i < blindeds.length; i += MAX_BODIES_REQUEST) {
    out.push(...(await reconstructEnvelopesBatch(executionEngine, blindeds.slice(i, i + MAX_BODIES_REQUEST))));
  }
  return out;
}

export function isRebuildMiss(result: gloas.SignedExecutionPayloadEnvelope | RebuildMiss): result is RebuildMiss {
  return "reason" in result;
}

/** One EL round-trip. Aligned with the input; never throws per envelope, only ENGINE_UNAVAILABLE. */
async function reconstructEnvelopesBatch(
  executionEngine: IExecutionEngine,
  blindeds: gloas.SignedBlindedExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[]> {
  if (blindeds.length === 0) return [];
  const hashes = blindeds.map((blinded) => toRootHex(blinded.message.payload.blockHash));

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

  return blindeds.map((blinded, i) => {
    const slot = blinded.message.payload.slotNumber;
    const body = bodies[i];
    // A zero-length block access list cannot be valid, RLP encodes an empty list as 0xc0
    if (body == null || body.withdrawals == null || body.blockAccessList == null || body.blockAccessList.length === 0) {
      return {slot, reason: "unavailable"};
    }
    try {
      return signedBlindedEnvelopeToFull(blinded, {
        transactions: body.transactions,
        withdrawals: body.withdrawals,
        blockAccessList: body.blockAccessList,
      });
    } catch (e) {
      if (e instanceof EnvelopeReconstructionError) return {slot, reason: "mismatch", error: e};
      throw e;
    }
  });
}
