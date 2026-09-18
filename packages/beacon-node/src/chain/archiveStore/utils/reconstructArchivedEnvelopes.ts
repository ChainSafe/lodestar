import {Slot, gloas, ssz} from "@lodestar/types";
import {Logger, pruneSetToMax, toRootHex} from "@lodestar/utils";
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

/**
 * Serialized envelopes rebuilt from the EL recently, keyed by slot. Several peers syncing the same
 * range would otherwise each cost a full round of EL calls plus a hashTreeRoot over ~270 KB per
 * envelope; 32 entries (one EL batch) bound that at ~9 MB. Eviction is FIFO, not LRU: a hit does not
 * refresh an entry. For sequential range sync that evicts the slots behind the peers' cursors first,
 * which is what we want. Keyed by slot is safe: the archive only holds canonical finalized envelopes,
 * one per slot (the hot→cold migration filters to fork-choice canonical ancestors).
 */
export const RECONSTRUCTED_ENVELOPE_CACHE_SIZE = 32;

export class ReconstructedEnvelopeCache {
  private readonly bySlot = new Map<Slot, Uint8Array>();

  constructor(private readonly maxEntries = RECONSTRUCTED_ENVELOPE_CACHE_SIZE) {}

  get(slot: Slot): Uint8Array | undefined {
    return this.bySlot.get(slot);
  }

  /** Insertion-ordered (FIFO) eviction; only successful reconstructions are cached, never misses. */
  set(slot: Slot, envelopeBytes: Uint8Array): void {
    this.bySlot.set(slot, envelopeBytes);
    pruneSetToMax(this.bySlot, this.maxEntries);
  }

  get size(): number {
    return this.bySlot.size;
  }
}

/** A finalized envelope ready to serve: the serialized `SignedExecutionPayloadEnvelope` bytes */
export type SlotEnvelopeBytes = {slot: Slot; envelopeBytes: Uint8Array};

/** A range entry read raw from the archive: full and cached ones already hold their servable bytes */
type RangeEntry =
  | {slot: Slot; kind: ArchivedEnvelopeKind.Full; envelopeBytes: Uint8Array}
  | {slot: Slot; kind: ArchivedEnvelopeKind.Compact; compact: SignedCompactExecutionPayloadEnvelope};

/** Why a compact envelope could not be rebuilt from the EL's bodies */
export type RebuildMiss =
  // Unknown block hash, pre-capella body shape, or a pruned block access list (absent or empty bytes)
  | {slot: Slot; reason: "unavailable"}
  // EL bodies do not hash to the archived payload root: a local inconsistency
  | {slot: Slot; reason: "mismatch"; error: EnvelopeReconstructionError};

export type ReconstructByRangeOpts = {
  /**
   * Start of the `MIN_EPOCHS_FOR_BLOCK_REQUESTS` window. Advisory only: it does not gate what is
   * attempted — the spec says peers MUST serve that window and MAY serve more, and how much more
   * is decided by the EL's block access list retention, so every compact entry is tried and the EL's
   * null is the floor. It only sets the log level of a miss: below the window a miss is the expected
   * condition for archival sync (debug); inside it the EL is failing to serve what the CL must serve
   * (warn, see ethereum/EIPs#12347).
   */
  servingWindowStartSlot: Slot;
  /** Recently rebuilt envelopes; consulted before the EL and populated after a successful rebuild */
  cache?: ReconstructedEnvelopeCache;
  /**
   * Called once, with the slot, when the stream ends before `endSlot` because an entry could not be
   * served. Lets the by-range handler distinguish "nothing archived in range" from "stopped short".
   * It fires right before the generator returns, so a caller must fully drain the stream before
   * reading whatever it recorded.
   */
  onUnservable?: (slot: Slot) => void;
};

/**
 * Stream finalized envelopes over [startSlot, endSlot) in slot order, as serialized bytes. Entries
 * are read raw and branched on the union selector byte: full entries (`--chain.dedupePayloads=false`)
 * are yielded as `bytes.subarray(1)` without deserializing; compact entries (~1 KB, the default) are
 * deserialized, rebuilt from EL bodies fetched in batches of MAX_BODIES_REQUEST (32) to bound
 * round-trips (a range request may span up to MAX_REQUEST_PAYLOADS = 128 slots), and re-serialized.
 *
 * The response must be consecutive (the by-range spec inherits BeaconBlocksByRange v2 semantics):
 * a syncing peer that already holds the blocks knows a skipped slot is FULL, so a hole looks like a
 * lying peer, whereas a short response is spec-legal and just gets retried elsewhere. So the stream
 * ENDS at the first entry the EL cannot serve, or that fails the payload root check, rather than
 * skipping it; `opts.onUnservable` is called with that slot. A root mismatch is logged at error
 * (it is a local inconsistency) but from the peer's point of view we simply do not have that envelope.
 *
 * Throws {@link EnvelopeReconstructionError} ENGINE_UNAVAILABLE only, if the EL call itself fails;
 * this may surface after some envelopes have already been yielded.
 */
export async function* reconstructArchivedEnvelopesByRange(
  db: IBeaconDb,
  executionEngine: IExecutionEngine,
  logger: Logger,
  startSlot: Slot,
  endSlot: Slot,
  opts: ReconstructByRangeOpts
): AsyncIterable<SlotEnvelopeBytes> {
  const archive = db.executionPayloadEnvelopeArchive;
  let batch: RangeEntry[] = [];

  for await (const {key, value: bytes} of archive.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
    const slot = archive.decodeKey(key);
    const value = bytes.subarray(ARCHIVED_ENVELOPE_SELECTOR_LENGTH);
    if (bytes[0] === ArchivedEnvelopeKind.Full) {
      batch.push({slot, kind: ArchivedEnvelopeKind.Full, envelopeBytes: value});
    } else {
      const cached = opts.cache?.get(slot);
      if (cached !== undefined) {
        batch.push({slot, kind: ArchivedEnvelopeKind.Full, envelopeBytes: cached});
      } else {
        batch.push({
          slot,
          kind: ArchivedEnvelopeKind.Compact,
          compact: signedCompactExecutionPayloadEnvelopeSsz.deserialize(value),
        });
      }
    }
    if (batch.length === MAX_BODIES_REQUEST) {
      const {envelopes, unservableSlot} = await reconstructBatch(executionEngine, logger, batch, opts);
      yield* envelopes;
      if (unservableSlot !== null) {
        opts.onUnservable?.(unservableSlot);
        return;
      }
      batch = [];
    }
  }
  if (batch.length > 0) {
    const {envelopes, unservableSlot} = await reconstructBatch(executionEngine, logger, batch, opts);
    yield* envelopes;
    if (unservableSlot !== null) opts.onUnservable?.(unservableSlot);
  }
}

/**
 * Reconstruct compact envelopes from EL bodies, in batches of MAX_BODIES_REQUEST. The result is
 * aligned with the input: `null` where the EL cannot serve that envelope's bodies. A payload root
 * mismatch THROWS here: the getter and REST callers surface it as a hard error (500), by-root as
 * SERVER_ERROR, since it is a local inconsistency an operator should see.
 */
export async function reconstructArchivedEnvelopes(
  executionEngine: IExecutionEngine,
  compacts: SignedCompactExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | null)[]> {
  const out: (gloas.SignedExecutionPayloadEnvelope | null)[] = [];
  for (let i = 0; i < compacts.length; i += MAX_BODIES_REQUEST) {
    for (const result of await rebuildCompacts(executionEngine, compacts.slice(i, i + MAX_BODIES_REQUEST))) {
      if (isRebuildMiss(result)) {
        if (result.reason === "mismatch") throw result.error;
        out.push(null);
      } else {
        out.push(result);
      }
    }
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

function isRebuildMiss(result: gloas.SignedExecutionPayloadEnvelope | RebuildMiss): result is RebuildMiss {
  return "reason" in result;
}

/**
 * One EL round-trip for up to MAX_BODIES_REQUEST compact envelopes. Aligned with the input, with a
 * {@link RebuildMiss} where the envelope could not be rebuilt. Never throws for a single envelope;
 * only ENGINE_UNAVAILABLE when the EL call itself fails.
 */
async function rebuildCompacts(
  executionEngine: IExecutionEngine,
  compacts: SignedCompactExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[]> {
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
    const slot = compact.message.payload.slotNumber;
    const body = bodies[i];
    // A pruned block access list comes back as null, or as empty bytes (0x) from some ELs
    // (OffchainLabs/prysm#17174). An RLP-encoded BAL is never empty (an empty list is 0xc0), so
    // length 0 means the EL no longer has it, not that the block had none.
    if (body == null || body.withdrawals == null || body.blockAccessList == null || body.blockAccessList.length === 0) {
      return {slot, reason: "unavailable"};
    }
    try {
      return signedCompactEnvelopeToFull(compact, {
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

/**
 * Rebuild the compact entries of a range batch in one EL round-trip, keeping slot order. Stops at the
 * first entry that cannot be served and returns its slot, so the caller ends the stream there instead
 * of leaving a hole.
 */
async function reconstructBatch(
  executionEngine: IExecutionEngine,
  logger: Logger,
  batch: RangeEntry[],
  {cache, servingWindowStartSlot}: ReconstructByRangeOpts
): Promise<{envelopes: SlotEnvelopeBytes[]; unservableSlot: Slot | null}> {
  const compacts: SignedCompactExecutionPayloadEnvelope[] = [];
  for (const entry of batch) {
    if (entry.kind === ArchivedEnvelopeKind.Compact) compacts.push(entry.compact);
  }
  const rebuilt = await rebuildCompacts(executionEngine, compacts);

  const envelopes: SlotEnvelopeBytes[] = [];
  let compactIdx = 0;
  for (const entry of batch) {
    if (entry.kind === ArchivedEnvelopeKind.Full) {
      envelopes.push({slot: entry.slot, envelopeBytes: entry.envelopeBytes});
      continue;
    }
    const result = rebuilt[compactIdx++];
    if (isRebuildMiss(result)) {
      if (result.reason === "mismatch") {
        logger.error("Archived envelope failed payload root check against EL bodies", {slot: entry.slot}, result.error);
      } else if (entry.slot < servingWindowStartSlot) {
        // Below MIN_EPOCHS_FOR_BLOCK_REQUESTS the EL may legitimately have pruned the block access list
        logger.debug("EL cannot serve bodies for archived envelope below serving window, ending range", {
          slot: entry.slot,
          servingWindowStartSlot,
        });
      } else {
        logger.warn("EL cannot serve bodies for archived envelope inside serving window, ending range", {
          slot: entry.slot,
          servingWindowStartSlot,
        });
      }
      return {envelopes, unservableSlot: entry.slot};
    }
    const envelopeBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(result);
    cache?.set(entry.slot, envelopeBytes);
    envelopes.push({slot: entry.slot, envelopeBytes});
  }
  return {envelopes, unservableSlot: null};
}
