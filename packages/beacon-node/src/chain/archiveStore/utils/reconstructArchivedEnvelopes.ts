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
 * Recently rebuilt envelopes (serialized), so N peers syncing the same range cost one round of EL
 * calls + hashTreeRoots, not N. 32 entries ≈ 9 MB. FIFO eviction (a hit does not refresh), which for
 * sequential sync drops the slots behind the cursors first. Slot key is safe: the archive only holds
 * canonical finalized envelopes.
 */
export const RECONSTRUCTED_ENVELOPE_CACHE_SIZE = 32;

export class ReconstructedEnvelopeCache {
  private readonly bySlot = new Map<Slot, Uint8Array>();

  constructor(private readonly maxEntries = RECONSTRUCTED_ENVELOPE_CACHE_SIZE) {}

  get(slot: Slot): Uint8Array | undefined {
    return this.bySlot.get(slot);
  }

  set(slot: Slot, envelopeBytes: Uint8Array): void {
    this.bySlot.set(slot, envelopeBytes);
    pruneSetToMax(this.bySlot, this.maxEntries);
  }

  get size(): number {
    return this.bySlot.size;
  }
}

/** Serialized `SignedExecutionPayloadEnvelope` ready to serve */
export type SlotEnvelopeBytes = {slot: Slot; envelopeBytes: Uint8Array};

/** Archive entry read raw; full and cached ones already hold servable bytes */
type RangeEntry =
  | {slot: Slot; kind: ArchivedEnvelopeKind.Full; envelopeBytes: Uint8Array}
  | {slot: Slot; kind: ArchivedEnvelopeKind.Compact; compact: SignedCompactExecutionPayloadEnvelope};

export type RebuildMiss =
  /** EL does not have the block, or has pruned its block access list */
  | {slot: Slot; reason: "unavailable"}
  /** EL bodies do not hash to the archived payloadRoot (local inconsistency) */
  | {slot: Slot; reason: "mismatch"; error: EnvelopeReconstructionError};

export type ReconstructByRangeOpts = {
  /**
   * Start of the MIN_EPOCHS_FOR_BLOCK_REQUESTS window. Does not gate what is attempted (every compact
   * entry is tried; the EL's null is the floor), only the log level of a miss: debug below the window,
   * warn inside it since the EL is then failing to serve what the CL must (ethereum/EIPs#12347).
   */
  servingWindowStartSlot: Slot;
  cache?: ReconstructedEnvelopeCache;
  /** Fires, right before the generator returns, when the stream stops short at an unservable slot */
  onUnservable?: (slot: Slot) => void;
};

/**
 * Stream finalized envelopes over [startSlot, endSlot) as serialized bytes. Full entries are served
 * as `bytes.subarray(1)` without deserializing; compact ones are rebuilt from EL bodies, 32 per
 * round-trip.
 *
 * The by-range spec inherits BeaconBlocksByRange v2 semantics: consecutive, MAY be short. A hole
 * looks like a lying peer to one that already holds the blocks, so the stream ends at the first
 * entry that cannot be served (EL miss, or payload root mismatch — logged at error, but to the peer
 * it is simply missing) and `opts.onUnservable` gets that slot.
 *
 * Throws {@link EnvelopeReconstructionError} ENGINE_UNAVAILABLE only, possibly after some envelopes
 * were already yielded.
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
 * Rebuild compact envelopes from EL bodies, 32 per round-trip. Aligned with the input, `null` where
 * the EL cannot serve the bodies. A payload root mismatch throws: REST (500) and by-root
 * (SERVER_ERROR) surface it as the local inconsistency it is.
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

/** Single-envelope variant of {@link reconstructArchivedEnvelopes} */
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

/** One EL round-trip. Aligned with the input; never throws per envelope, only ENGINE_UNAVAILABLE. */
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
    // A pruned BAL comes back null or, from some ELs, as 0x (OffchainLabs/prysm#17174). RLP is never
    // empty (empty list is 0xc0), so length 0 means pruned.
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

/** Rebuild a range batch in one EL round-trip, stopping at the first unservable entry */
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
