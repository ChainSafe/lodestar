import {RootHex, Slot} from "@lodestar/types";
import {PeerIdStr} from "../../util/peerId.js";
import {SpillStore} from "./spillStore.js";

/** A single element in the header-chain used by TargetSync. */
export type HeaderChainElement = {
  /** Block root (hex). */
  root: RootHex;
  /** Parent beacon-block root (hex). */
  parentRoot: RootHex;
  slot: Slot;
  /** EL block hash from the execution payload bid (gloas+). */
  blockHash: RootHex;
  /** EL parent block hash from the execution payload bid (gloas+). */
  parentBlockHash: RootHex;
  /** Number of blobs committed in the bid (0 when no bid present, i.e. pre-gloas). */
  blobCount: number;
};

/**
 * An ordered sequence of header-chain elements.
 *
 * The backward walk returns it bottom-first: `[0]` is the oldest block (the one
 * whose parent is the fork-choice intersection) and the last element is the
 * walk target.
 */
export type HeaderChain = HeaderChainElement[];

// ---------------------------------------------------------------------------
// Target FSM contracts (rebuild)
//
// A `Target` is one root the engine has committed to bringing into fork
// choice, with its full payload lineage. Targets are hash-committed work: the
// walked header chain below a target is uniquely determined by its root, so
// partial walk progress is always safe to keep, transfer (coalescing), or
// resume (owner death).
// ---------------------------------------------------------------------------

/** Why a target is parked (waiting on something outside its control). */
export type ParkReason =
  /** Transient walk/import failure — retry after the backoff expires. */
  | "backoff"
  /** Import blocked on the intersection parent's payload envelope (a fill is the wake source). */
  | "awaitingParentPayload"
  /** DA gap — column/envelope data not yet available; refill and retry. */
  | "awaitingData"
  /** Execution engine unavailable/syncing — never peer-attributable. */
  | "elOffline"
  /** No eligible peer (connectivity or quota) for the next request. */
  | "peerStarved";

/**
 * Terminal outcomes. Every admitted target reaches exactly one terminal
 * (liveness invariant I2); terminal entry atomically releases everything the
 * target owns (spill rows, walked-root ownership, waiters, timers).
 */
export type TargetTerminal =
  /** Target root in fork choice with payload lineage satisfied; waiters re-emitted. */
  | "completed"
  /** Chain provably invalid or finality-conflicting — badTargets + exact/claimed-root scoring. */
  | "invalid"
  /** Attempt budgets spent without reaching a verdict — no penalty, cooled down. */
  | "exhausted"
  /** Another target owns this chain segment now (coalescing); waiters transferred. */
  | "superseded"
  /** Engine close() — no penalty, no cleanup I/O beyond memory release. */
  | "aborted"
  /** Tip at/below the finalized floor — stale honest chain, no penalty [A8]. */
  | "too_old";

export type TargetStatus =
  /** Admitted, not yet scheduled. */
  | {kind: "queued"}
  /** Backward walk in progress (cursor = `Target.walkAnchor` + `Target.headerChain`). */
  | {kind: "walking"}
  /** Waiting; `untilMs` is the backoff deadline (0 = wake-driven only), `resume` names the re-entry phase. */
  | {kind: "parked"; reason: ParkReason; untilMs: number; resume: "walk" | "import"}
  /** Bottom-up segment import in progress (holds the import slot only per-segment [A6]). */
  | {kind: "importing"}
  /** Walk converged on a chain owned by another live target; resumes on the owner's terminal [A4]. */
  | {kind: "awaitingOwner"; owner: RootHex}
  | {kind: "terminal"; terminal: TargetTerminal};

/** How the target came to exist — drives priority and the `importAttestations` policy. */
export type TargetKind = "finalized" | "head" | "byRoot";

/** A blocked child to re-emit on target completion — a reference, never a pinned input [A10]. */
export type TargetWaiter = {rootHex: RootHex; peer: PeerIdStr};

export type Target = {
  root: RootHex;
  /** Slot claimed by STATUS/gossip when known; admission gate + priority + depth ceiling use it. */
  slotHint: Slot | undefined;
  kind: TargetKind;
  status: TargetStatus;
  /**
   * peer → the root that peer actually claimed (STATUS head/finalized root, or the gossip
   * subject root). Scoring on terminal `invalid` keys off claimed roots: only advocates whose
   * claimed root sits at/above the first invalid block are penalized [A2].
   */
  advocates: Map<PeerIdStr, RootHex>;
  /** Blocked children to re-emit on completion (cap TARGET_WAITERS_MAX, FIFO) [A10]. */
  waiters: TargetWaiter[];
  /**
   * Walked header chain. Newest-first while walking; reversed to bottom-first when the walk
   * intersects fork choice. ~70 B/element — the memory-cheap index over the spilled blocks.
   */
  headerChain: HeaderChainElement[];
  /** Next by-head anchor (parentRoot of the oldest verified block); the target root pre-walk. */
  walkAnchor: RootHex;
  /** blockRoot → serving peer, for exact-block attribution on invalid verdicts [A3]. */
  provenance: Map<RootHex, PeerIdStr>;
  /**
   * Peers that failed a hop for this walk (bad/empty response) — excluded from selection
   * until the walk either runs out of alternatives (set is reset) or the target terminates.
   * Transient rotation state, never serialized.
   */
  walkExclude?: Set<PeerIdStr>;
  /** The fork-choice block the walked chain builds on, once the walk connects. */
  intersectionRoot: RootHex | undefined;
  attempts: {walk: number; import: number};
  /**
   * Index into the (bottom-first) `headerChain` of the next element to import.
   * Import is resumable at any segment boundary: resume state = spill + fork choice.
   */
  importCursor?: number;
  /** Bytes this target holds in the spill store (quota accounting). */
  spillBytes: number;
  createdAtMs: number;
  /** Per-target block staging (created at admission, cleared atomically at terminal). */
  spill: SpillStore;
};

// Caps (dossier §2.3/§2.8). Exported so tests pin them explicitly.
export const TARGET_QUEUE_MAX = 64;
export const TARGETS_PER_ADVOCATE_MAX = 2;
export const TARGET_WAITERS_MAX = 128;
