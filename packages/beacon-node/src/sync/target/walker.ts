import {ChainForkConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {RequestError} from "@lodestar/reqresp";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {PeerIdStr} from "../../util/peerId.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "../backfill/errors.js";
import {verifyBlockSequence} from "../backfill/verify.js";
import {classifyRequestError, parkIfRateLimited} from "./errorPolicy.js";
import {toHeaderChainElement} from "./headerChain.js";
import {earliestAvailableMs, selectAndReservePeer} from "./peerSelection.js";
import {InvalidBytesLedger, QuotaLedger} from "./quotaLedger.js";
import {SpillQuotaError, SpillStore} from "./spillStore.js";
import {Target} from "./types.js";

// ---------------------------------------------------------------------------
// Walker — one backward by-head hop of a target's walk.
//
// Hash-committed: each hop re-anchors on a root committed by the previous
// hop's parentRoot (transitively by the target root itself), so the walked
// chain is uniquely determined by the target root. Consequences the design
// leans on:
//  - Peers cannot inject divergent chains mid-walk; a peer either serves the
//    committed content or is provably NOT_ANCHORED/NOT_LINEAR.
//  - Partial progress is ALWAYS safe to keep: on a bad tail we keep the
//    hash-verified prefix, rotate peers, and continue (never discard a walk).
//  - Committed-content violations (non-descending slots, descending past the
//    finalized floor without intersecting) indict the CHAIN — a terminal
//    `invalid` verdict for the target — not the serving peer, who faithfully
//    relayed what the root commits to.
//
// The walker advances ONE hop per call and returns an outcome; scheduling,
// backoff, terminal handling, and advocate scoring live in the FSM.
// ---------------------------------------------------------------------------

/**
 * [A15] Slots of clock skew tolerated on the walk tip before the response is
 * discarded (MAX_CLOCK_DISPARITY is sub-slot; one full slot is generous).
 */
export const TIP_CLOCK_SLACK_SLOTS = 1;

export type WalkHopResult =
  /** Walk connected to fork choice — the target is ready to import. */
  | {outcome: "intersected"; intersectionRoot: RootHex}
  /** Hop verified and staged; keep walking. */
  | {outcome: "progress"}
  /** [A8] Verified tip at/below the finalized floor — stale honest chain, no penalty. */
  | {outcome: "tooOld"}
  /**
   * The hash-committed chain content is provably invalid: it descends past the
   * finalized floor without intersecting (finality conflict) or violates slot
   * monotonicity. Terminal `invalid`; advocate scoring is the FSM's job [A2].
   */
  | {outcome: "invalidChain"; reason: "finalityConflict" | "nonMonotonicSlots"}
  /** No eligible peer/quota right now; retry when the ledger advises. */
  | {outcome: "peerStarved"; retryAtMs: number}
  /** Bad/empty response — offender excluded/parked; re-invoke to rotate. */
  | {outcome: "emptyHop"}
  /** Spill quota breached — the gap is too large for backward sync (→ checkpoint sync). */
  | {outcome: "quotaExceeded"}
  | {outcome: "aborted"};

export type WalkerDeps = {
  config: ChainForkConfig;
  /** Blocks requested per hop (MAX_REQUEST_BLOCKS_DENEB; full hops — safety is spacing [A11]). */
  hopBlocks: number;
  currentSlot(): Slot;
  forkChoice: Pick<IForkChoice, "hasBlockHex" | "getFinalizedCheckpointSlot">;
  sendBeaconBlocksByHead(peer: PeerIdStr, beaconRoot: Uint8Array, count: number): Promise<SignedBeaconBlock[]>;
  connectedPeers(): PeerIdStr[];
  ledger: QuotaLedger;
  invalidBytes: InvalidBytesLedger;
  spill: Pick<SpillStore, "put">;
  /** Low-tolerance report for provably-bad RESPONSES (not committed-content verdicts). */
  reportPeerLow(peer: PeerIdStr, reason: string): void;
  signal: AbortSignal;
};

/**
 * Advance `target`'s walk by one by-head hop, mutating its cursor
 * (`headerChain` newest-first, `walkAnchor`, `provenance`) and staging
 * verified blocks into the spill (bounds checked BEFORE every write).
 */
export async function walkHop(target: Target, deps: WalkerDeps): Promise<WalkHopResult> {
  if (deps.signal.aborted) return {outcome: "aborted"};
  const {config, ledger} = deps;

  // --- select + reserve (atomic) --------------------------------------------
  const connected = deps.connectedPeers();
  const peer = selectAndReservePeer({
    kind: "byHead",
    units: deps.hopBlocks,
    ledger,
    connected,
    advocates: target.advocates,
    exclude: target.walkExclude,
  });
  if (peer === null) {
    if (target.walkExclude !== undefined && target.walkExclude.size > 0) {
      // Out of non-excluded alternatives: reset rotation state and let the
      // next invocation retry the full set (an offender beats no peer at all).
      target.walkExclude = undefined;
      return {outcome: "emptyHop"};
    }
    return {outcome: "peerStarved", retryAtMs: earliestAvailableMs(ledger, connected, "byHead", deps.hopBlocks)};
  }

  // --- request ----------------------------------------------------------------
  let blocks: SignedBeaconBlock[];
  try {
    blocks = await deps.sendBeaconBlocksByHead(peer, fromHex(target.walkAnchor), deps.hopBlocks);
  } catch (e) {
    ledger.release(peer, "byHead");
    if (deps.signal.aborted) return {outcome: "aborted"};
    if (e instanceof RequestError) {
      if (!parkIfRateLimited(ledger, peer, e) && classifyRequestError(e.type.code).action === "rotate") {
        excludePeer(target, peer);
      }
      // selfThrottle without a deadline: the peer is neither excluded nor parked.
    } else {
      // Unknown transport fault: rotate, never score.
      excludePeer(target, peer);
    }
    return {outcome: "emptyHop"};
  }
  ledger.release(peer, "byHead");
  if (deps.signal.aborted) return {outcome: "aborted"};

  if (blocks.length === 0) {
    // Honest absence — rotate, never score.
    excludePeer(target, peer);
    return {outcome: "emptyHop"};
  }

  // --- verify the hop against the committed anchor ----------------------------
  let seq: ReturnType<typeof verifyBlockSequence>;
  try {
    // verifyBlockSequence expects oldest-first input (it re-reverses internally) with the
    // anchor being the newest block's root; sendByHead returns newest-first.
    seq = verifyBlockSequence(config, blocks.slice().reverse(), fromHex(target.walkAnchor));
  } catch (e) {
    if (e instanceof BackfillSyncError && e.type.code === BackfillSyncErrorCode.NOT_ANCHORED) {
      // Did not serve the requested root — provably bad response.
      deps.reportPeerLow(peer, "byhead_not_anchored");
      excludePeer(target, peer);
      return {outcome: "emptyHop"};
    }
    throw e;
  }
  if (seq.error === BackfillSyncErrorCode.NOT_LINEAR) {
    // Garbage after a valid prefix — keep the hash-committed prefix, drop the tail,
    // score the response, rotate. The walk NEVER discards verified progress.
    deps.reportPeerLow(peer, "byhead_not_linear");
    excludePeer(target, peer);
  }
  if (seq.verifiedBlocks.length === 0) {
    excludePeer(target, peer);
    return {outcome: "emptyHop"};
  }

  const floor = deps.forkChoice.getFinalizedCheckpointSlot();
  const firstHop = target.headerChain.length === 0;
  const tipSlot = seq.verifiedBlocks[0].message.slot;

  if (firstHop) {
    // [A15] Tip clock sanity. The tip is hash-committed to the claimed root, so a
    // far-future tip indicts the CLAIM: score the server only when it advocated the
    // root itself (exact attribution, I13); otherwise just rotate.
    if (tipSlot > deps.currentSlot() + TIP_CLOCK_SLACK_SLOTS) {
      if (target.advocates.has(peer)) deps.reportPeerLow(peer, "byhead_future_tip");
      excludePeer(target, peer);
      return {outcome: "emptyHop"};
    }
    // [A8] Stale honest chain: nothing above the floor to import — no penalty.
    if (tipSlot <= floor) return {outcome: "tooOld"};
  }

  // --- stage verified blocks ---------------------------------------------------
  // Strictly-descending slot guard: hash linkage does NOT constrain slot content of a
  // fabricated chain; non-monotone slots would defeat the floor bound and span accounting.
  let prevSlot = firstHop ? Number.POSITIVE_INFINITY : oldestWalkedSlot(target);

  for (const block of seq.verifiedBlocks) {
    const slot = block.message.slot;
    if (slot >= prevSlot) return {outcome: "invalidChain", reason: "nonMonotonicSlots"};
    prevSlot = slot;

    const forkTypes = config.getForkTypes(slot);
    const rootHex = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(block.message));
    const parentRootHex = toRootHex(block.message.parentRoot);

    // Bounds are enforced inside the spill BEFORE the row is written.
    try {
      await deps.spill.put(rootHex, block, deps.signal);
    } catch (e) {
      if (e instanceof SpillQuotaError) return {outcome: "quotaExceeded"};
      throw e;
    }
    if (deps.signal.aborted) return {outcome: "aborted"};

    // Exact-block attribution [A3] + pending invalid-bytes charge [A9].
    target.provenance.set(rootHex, peer);
    deps.invalidBytes.charge(target.root, peer, forkTypes.SignedBeaconBlock.serialize(block).length);

    target.headerChain.push(toHeaderChainElement(config, block, rootHex));
    target.walkAnchor = parentRootHex;

    if (deps.forkChoice.hasBlockHex(parentRootHex)) {
      // Connected: flip to bottom-first for import and stop — checking per block
      // (not per hop) avoids descending past the intersection into older history.
      target.headerChain.reverse();
      target.intersectionRoot = parentRootHex;
      target.walkExclude = undefined;
      return {outcome: "intersected", intersectionRoot: parentRootHex};
    }

    if (slot <= floor) {
      // Descended to the floor without intersecting, with a tip above the floor:
      // the chain provably conflicts with finality.
      return {outcome: "invalidChain", reason: "finalityConflict"};
    }
  }

  return {outcome: "progress"};
}

function excludePeer(target: Target, peer: PeerIdStr): void {
  if (target.walkExclude === undefined) target.walkExclude = new Set();
  target.walkExclude.add(peer);
}

/** Oldest slot walked so far (headerChain is newest-first while walking). */
function oldestWalkedSlot(target: Target): Slot {
  const last = target.headerChain.at(-1);
  return last !== undefined ? last.slot : Number.POSITIVE_INFINITY;
}
