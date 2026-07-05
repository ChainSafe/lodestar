import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {BlockInputSource, IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {AttestationImportOpt, ImportBlockOpts} from "../../chain/blocks/types.js";
import {BlockError} from "../../chain/errors/blockError.js";
import {IBeaconChain} from "../../chain/interface.js";
import {INetwork} from "../../network/interface.js";
import {PeerIdStr} from "../../util/peerId.js";
import {fetchAndValidateBlock} from "../utils/downloadByRoot.js";
import {dataFill} from "./dataFill.js";
import {DataFillItem, buildDataFillPlan} from "./dataFillPlan.js";
import {classifyBlockImportError} from "./errorPolicy.js";
import {toHeaderChainElement} from "./headerChain.js";
import {selectAndReservePeer} from "./peerSelection.js";
import {QuotaLedger} from "./quotaLedger.js";
import {HeaderChainElement, ParkReason, Target} from "./types.js";

// ---------------------------------------------------------------------------
// Importer — one bottom-up epoch segment per call [A6].
//
// The import slot is granted per SEGMENT, not per target: each call imports
// exactly one same-epoch slice, so a deep target cannot head-of-line block a
// small one, and preemption needs no cleanup — materialization is strictly
// just-in-time (assemble → submit in the same call), so nothing is ever
// staged speculatively. Resume state is spill + fork choice, nothing else:
// the cursor is re-derived from `hasBlockHex` on every call, which also
// absorbs partial imports (`ignoreIfKnown`) and gossip races.
// ---------------------------------------------------------------------------

export type ImportStepResult =
  /** One segment landed; call again for the next (unless `done`). */
  | {step: "segmentImported"; upToSlot: Slot; done: boolean}
  /** Target root is in fork choice with its lineage — terminal `completed`. */
  | {step: "completed"}
  /** Blocks/data for the next segment aren't ready — park `awaitingData` and refill. */
  | {step: "notReady"}
  /** The bottom parent's payload envelope is missing — park + EnvelopeFill wake. */
  | {step: "parkParentPayload"; parentRoot: RootHex}
  /** Transient import failure — park per the error policy. */
  | {step: "park"; reason: ParkReason}
  /** Chain provably invalid; `firstInvalidRoot` identifies the block when known [A3]. */
  | {step: "invalid"; firstInvalidRoot: RootHex | null; reason: string}
  /** Fork choice moved beneath the walk (finalization advance) — rewalk. */
  | {step: "reanchor"}
  /** Unexpected fault — warn + meter at the caller; budget converts repeats to exhausted. */
  | {step: "internal"; reason: string}
  | {step: "aborted"};

export type ImporterDeps = {
  config: ChainForkConfig;
  chain: IBeaconChain;
  network: INetwork;
  ledger: QuotaLedger;
  connectedPeers(): PeerIdStr[];
  /** Data-fill peer scoring pass-through (gated/deduped by the facade). */
  reportPeer(peerIdStr: PeerIdStr, reason: string): void;
  signal: AbortSignal;
};

/** Segment import flags. `importAttestations` varies by segment age; the rest are static. */
const IMPORT_OPTS = {
  ignoreIfKnown: true,
  ignoreIfFinalized: true,
} satisfies ImportBlockOpts;

/** Peers handed to the data-fill executor: advocates first, padded with connected peers. */
const FILL_PEERS_MAX = 24;

export async function importNextSegment(target: Target, deps: ImporterDeps): Promise<ImportStepResult> {
  const {config, chain, signal} = deps;
  if (signal.aborted) return {step: "aborted"};

  // Gossip race / already done.
  if (chain.forkChoice.hasBlockHex(target.root)) return {step: "completed"};

  const headerChain = target.headerChain;
  if (headerChain.length === 0 || target.intersectionRoot === undefined) {
    return {step: "internal", reason: "import_without_walk"};
  }

  // Re-derive the cursor from fork choice (absorbs partial imports + races).
  let cursor = target.importCursor ?? 0;
  while (cursor < headerChain.length && chain.forkChoice.hasBlockHex(headerChain[cursor].root)) cursor++;
  target.importCursor = cursor;
  if (cursor >= headerChain.length) {
    // Everything imported but the top somehow isn't the target — unreachable given
    // headerChain's last element IS the target (checked above via hasBlockHex).
    return {step: "internal", reason: "cursor_past_chain"};
  }

  // Next same-epoch segment from the cursor.
  const segment: HeaderChainElement[] = [];
  const segEpoch = computeEpochAtSlot(headerChain[cursor].slot);
  for (let i = cursor; i < headerChain.length && computeEpochAtSlot(headerChain[i].slot) === segEpoch; i++) {
    segment.push(headerChain[i]);
  }

  // Fill plan for the whole chain (pure), filtered to this segment.
  const plan = buildDataFillPlan(config, headerChain, chain.clock.currentEpoch);
  const planByRoot = new Map(plan.map((item) => [item.root, item]));
  const segmentItems = segment
    .map((el) => planByRoot.get(el.root))
    .filter((item): item is DataFillItem => item !== undefined);

  const fillPeers = new Set<PeerIdStr>([...target.advocates.keys(), ...deps.connectedPeers().slice(0, FILL_PEERS_MAX)]);

  // Bottom-parent payload seeding: only for the first (bottom) segment of a gloas chain.
  let bottomParent: {slot: Slot; payloadInput: PayloadEnvelopeInput} | undefined;
  if (cursor === 0) {
    const prime = await primeBottomParentPayload(target, deps, fillPeers);
    if (prime.result === "park") return {step: "parkParentPayload", parentRoot: target.intersectionRoot};
    if (prime.result === "aborted") return {step: "aborted"};
    bottomParent = prime.payloadInput;
  }
  if (signal.aborted) return {step: "aborted"};

  // Best-effort fill for this segment (deferred items surface as notReady below).
  await dataFill(segmentItems, {
    config,
    chain,
    network: deps.network,
    store: target.spill,
    peers: fillPeers,
    reportPeer: deps.reportPeer,
    ledger: deps.ledger,
  });
  if (signal.aborted) return {step: "aborted"};

  // --- Gated assembly (all-or-nothing; an incomplete NEEDED input defers, never poisons) ---
  const blocks: IBlockInput[] = [];
  const payloadEnvelopes = new Map<Slot, PayloadEnvelopeInput>();
  const seenTimestampSec = Date.now() / 1000;

  for (const el of segment) {
    const block = await target.spill.get(el.root, el.slot, signal);
    if (block === null) return signal.aborted ? {step: "aborted"} : {step: "notReady"};
    const item = planByRoot.get(el.root);

    const blockInput = chain.seenBlockInputCache.getByBlock({
      blockRootHex: el.root,
      block,
      source: BlockInputSource.byRange,
      seenTimestampSec,
      peerIdStr: undefined,
    });
    // Fulu DA gate: a block input still missing needed columns would stall inside
    // processChainSegment's availability wait — defer instead.
    if (item?.needsColumns && config.getForkSeq(el.slot) < ForkSeq.gloas && !blockInput.hasBlockAndAllData())
      return {step: "notReady"};
    blocks.push(blockInput);

    const payloadInput = chain.seenPayloadEnvelopeInputCache.get(el.root);
    // isComplete() (hasPayload && hasAllData) is the EXACT predicate guarding the
    // downstream getTimeComplete() throw — the poison-map gate must match it.
    if (payloadInput?.isComplete()) {
      payloadEnvelopes.set(el.slot, payloadInput);
    } else if (item?.needsEnvelope) {
      // A NEEDED envelope is absent/incomplete: an incomplete input in the map throws a
      // NON-classifiable error inside DA verification and would kill the target — defer.
      return {step: "notReady"};
    }
    // else: EMPTY/tip — absence downstream produces classifiable BlockErrors.
  }

  if (bottomParent !== undefined) {
    payloadEnvelopes.set(bottomParent.slot, bottomParent.payloadInput);
  }

  // Attestation-import policy: recent segments feed fork-choice head updates; deep
  // history is skipped (a deep head-kind target must not import thousands of stale ones).
  const currentEpoch = chain.clock.currentEpoch;
  const importAttestations = segEpoch >= currentEpoch - 1 ? undefined : AttestationImportOpt.Skip;

  try {
    await chain.processChainSegment(blocks, payloadEnvelopes, {...IMPORT_OPTS, importAttestations});
  } catch (e) {
    if (signal.aborted) return {step: "aborted"};
    if (e instanceof BlockError) return mapBlockError(config, e, target);
    return {step: "internal", reason: (e as Error).message};
  }
  if (signal.aborted) return {step: "aborted"};

  // Post-segment verification: processChainSegment resolving without the blocks landing
  // (absent-without-error) means the processor was aborted — never treat as progress (R7).
  const lastEl = segment.at(-1) as HeaderChainElement;
  if (!chain.forkChoice.hasBlockHex(lastEl.root)) {
    return {step: "internal", reason: "segment_absent_after_import"};
  }

  // Progress: release the segment's spill rows (spill size is a live progress signal)
  // and advance the cursor.
  await target.spill.deleteUpToSlot(lastEl.slot, signal);
  target.importCursor = cursor + segment.length;
  target.attempts.import = 0;

  const done = chain.forkChoice.hasBlockHex(target.root);
  return done ? {step: "completed"} : {step: "segmentImported", upToSlot: lastEl.slot, done: false};
}

/** Map a classifiable import failure to an FSM directive. */
function mapBlockError(config: ChainForkConfig, e: BlockError, target: Target): ImportStepResult {
  const action = classifyBlockImportError(e.type.code);
  switch (action.action) {
    case "benign":
      // Segment-level benign (already known) — let the next call re-derive the cursor.
      return {step: "segmentImported", upToSlot: target.headerChain[target.importCursor ?? 0].slot, done: false};
    case "invalid": {
      // Exact-block attribution [A3]: identify the failing block from the error itself;
      // when unidentifiable, scope-chain verdicts implicate the whole chain (null).
      let firstInvalidRoot: RootHex | null = null;
      if (action.scope === "block") {
        const block = e.signedBlock;
        firstInvalidRoot = toRootHex(config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
      }
      return {step: "invalid", firstInvalidRoot, reason: e.type.code};
    }
    case "park":
      if (action.reason === "awaitingParentPayload") {
        const cursorEl = target.headerChain[target.importCursor ?? 0];
        return {step: "parkParentPayload", parentRoot: cursorEl.parentRoot};
      }
      return {step: "park", reason: action.reason};
    case "reanchor":
      return {step: "reanchor"};
    case "internal":
      return {step: "internal", reason: e.type.code};
  }
}

// ---------------------------------------------------------------------------
// Bottom-parent payload seeding (gloas): the first segment's sanity checks
// need the intersection parent's payload when the bottom block builds FULL on
// it. Cached/fork-choice knowledge short-circuits; otherwise fetch + admit by
// root; a definitive miss PARKS the target (the fill/SSE wake re-drives it)
// instead of stalling into a wasted processChainSegment.
// ---------------------------------------------------------------------------

type PrimeResult =
  | {result: "ok"; payloadInput?: {slot: Slot; payloadInput: PayloadEnvelopeInput}}
  | {result: "park"}
  | {result: "aborted"};

async function primeBottomParentPayload(
  target: Target,
  deps: ImporterDeps,
  fillPeers: Set<PeerIdStr>
): Promise<PrimeResult> {
  const {config, chain, signal} = deps;
  const bottom = target.headerChain[0];
  const intersectionRoot = target.intersectionRoot;
  if (bottom === undefined || intersectionRoot === undefined) return {result: "ok"};
  // Pre-gloas bottoms carry their payload inline — nothing to seed.
  if (config.getForkSeq(bottom.slot) < ForkSeq.gloas) return {result: "ok"};

  // Lineage already satisfied in fork choice (EMPTY parent or payload known)?
  if (chain.forkChoice.getBlockHexAndBlockHash(intersectionRoot, bottom.parentBlockHash) !== null) {
    return {result: "ok"};
  }

  // Complete envelope already admitted?
  const cached = chain.seenPayloadEnvelopeInputCache.get(intersectionRoot);
  if (cached?.isComplete()) {
    return {result: "ok", payloadInput: {slot: cached.slot, payloadInput: cached}};
  }

  // Need the parent block to classify + fetch its envelope.
  let block: SignedBeaconBlock;
  try {
    const local = await chain.getBlockByRoot(intersectionRoot);
    if (local !== null && local !== undefined) {
      block = local.block;
    } else {
      const peer = selectAndReservePeer({
        kind: "blocksByRoot",
        units: 1,
        ledger: deps.ledger,
        connected: deps.connectedPeers(),
        advocates: target.advocates,
      });
      if (peer === null) return {result: "park"};
      try {
        block = await fetchAndValidateBlock({
          config,
          network: deps.network,
          peerIdStr: peer,
          blockRoot: fromHex(intersectionRoot),
        });
      } finally {
        deps.ledger.release(peer, "blocksByRoot");
      }
    }
  } catch (_e) {
    return signal.aborted ? {result: "aborted"} : {result: "park"};
  }
  if (signal.aborted) return {result: "aborted"};

  // Only gloas parents carry a separate envelope (fork boundary case).
  if (config.getForkSeq(block.message.slot) < ForkSeq.gloas) return {result: "ok"};

  // Classify the intersection through the normal plan, with the real bottom as its child
  // (FULL → fetch envelope+columns; EMPTY → nothing), then run one fill pass.
  try {
    await target.spill.put(intersectionRoot, block, signal);
    const intersectionEl = toHeaderChainElement(config, block, intersectionRoot);
    const [item] = buildDataFillPlan(config, [intersectionEl, bottom], chain.clock.currentEpoch);
    await dataFill([item], {
      config,
      chain,
      network: deps.network,
      store: target.spill,
      peers: fillPeers,
      reportPeer: deps.reportPeer,
      ledger: deps.ledger,
    });
  } catch (_e) {
    return signal.aborted ? {result: "aborted"} : {result: "park"};
  }

  const primed = chain.seenPayloadEnvelopeInputCache.get(intersectionRoot);
  if (primed?.isComplete()) {
    return {result: "ok", payloadInput: {slot: primed.slot, payloadInput: primed}};
  }
  // Definitive miss this pass — park rather than submit a segment that will fail.
  return {result: "park"};
}
