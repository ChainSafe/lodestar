import {RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {PeerIdStr} from "../../util/peerId.js";
import {InvalidBytesLedger} from "./quotaLedger.js";
import {SpillStore} from "./spillStore.js";
import {
  TARGETS_PER_ADVOCATE_MAX,
  TARGET_QUEUE_MAX,
  TARGET_WAITERS_MAX,
  Target,
  TargetKind,
  TargetTerminal,
  TargetWaiter,
} from "./types.js";
import {WalkHopResult} from "./walker.js";

// ---------------------------------------------------------------------------
// TargetStore — target admission, coalescing, the FSM transitions, and the
// atomic terminal release.
//
// Invariants owned here:
//  - I2 (terminality): every admitted target reaches exactly one terminal.
//    Walk/import attempts carry budgets; parks carry deadlines the per-slot
//    scan expires; awaitingOwner exits on every owner terminal [A4].
//  - Atomic terminal release: leaving the live set releases everything the
//    target owns — spill rows, walked-root ownership, waiters, pending
//    invalid-bytes — in the same synchronous step (db deletes are async but
//    signal-guarded; the boot wipe owns anything a crash strands).
//  - I13 (attribution exact or absent): on terminal `invalid`, advocates whose
//    CLAIMED root sits at/above the first invalid block eat Mid [A2]; advocates
//    of the successfully-imported prefix are vindicated. Walk-level verdicts
//    (finality conflict / slot games) implicate the whole chain.
// ---------------------------------------------------------------------------

/** Failed walk attempts (bad/empty hops) before the target is `exhausted`. */
export const WALK_ATTEMPTS_MAX = 32;
/** Failed import attempts before the target is `exhausted`. */
export const IMPORT_ATTEMPTS_MAX = 16;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** Cooldown before a dropped (too_old / exhausted) root may be re-admitted. */
export const RECENTLY_DROPPED_MS = 60_000;
/** Proven-invalid roots remembered (LRU-by-hit) [A14]. */
export const BAD_TARGETS_MAX = 500;

export type UpsertClaim = {
  root: RootHex;
  slotHint?: Slot;
  kind: TargetKind;
  /** Advocating peer; `claimedRoot` is what the peer actually named (defaults to `root`) [A2]. */
  peer?: PeerIdStr;
  claimedRoot?: RootHex;
  /** Blocked child to re-emit when this target completes [A10]. */
  waiter?: TargetWaiter;
};

export type UpsertResult =
  | {result: "admitted"; target: Target}
  | {result: "fed"; target: Target}
  | {result: "coalesced"; owner: Target}
  | {
      result: "rejected";
      reason: "inForkChoice" | "belowFloor" | "badTarget" | "cooldown" | "queueFull" | "advocateCap";
    };

export type TargetStoreDeps = {
  now(): number;
  finalizedSlot(): Slot;
  hasBlockHex(root: RootHex): boolean;
  createSpill(targetRoot: RootHex): SpillStore;
  invalidBytes: InvalidBytesLedger;
  /** Mid to an advocate whose claimed root proved invalid [A2] (gate/dedup at the caller). */
  reportPeerMid(peer: PeerIdStr, reason: string): void;
  /** Low per invalid-bytes threshold crossed [A9]. */
  reportPeerLow(peer: PeerIdStr, reason: string): void;
  /** Completed-target waiters to re-emit (rehydrated by the facade from the seen caches). */
  onWaiters(waiters: TargetWaiter[]): void;
  /** A target completed (re-STATUS its advocates, notify sync state, wake fills). */
  onCompleted(target: Target): void;
  logger: Logger;
  signal: AbortSignal;
};

export class TargetStore {
  /** Live targets by root. */
  readonly targets = new Map<RootHex, Target>();
  /** Walked block root → owning target root (coalescing / supersede detection). */
  private readonly walkedRoots = new Map<RootHex, RootHex>();
  /** Proven-invalid roots, insertion-ordered, refreshed on hit (LRU-by-hit) [A14]. */
  private readonly badTargets = new Map<RootHex, true>();
  /** Dropped roots under re-admission cooldown: root → expiry. */
  private readonly recentlyDropped = new Map<RootHex, number>();
  /** Terminal counters (observability; wired to metrics by the facade). */
  readonly terminals: Record<TargetTerminal, number> = {
    completed: 0,
    invalid: 0,
    exhausted: 0,
    superseded: 0,
    aborted: 0,
    too_old: 0,
  };

  constructor(private readonly deps: TargetStoreDeps) {}

  // -------------------------------------------------------------------------
  // Admission
  // -------------------------------------------------------------------------

  upsert(claim: UpsertClaim): UpsertResult {
    const {root} = claim;

    // Feed an existing target.
    const existing = this.targets.get(root);
    if (existing !== undefined) {
      this.feed(existing, claim);
      return {result: "fed", target: existing};
    }

    // Root already walked by a live target — coalesce onto the owner.
    const ownerRoot = this.walkedRoots.get(root);
    const owner = ownerRoot !== undefined ? this.targets.get(ownerRoot) : undefined;
    if (owner !== undefined) {
      this.feed(owner, claim);
      return {result: "coalesced", owner};
    }

    // Gates, cheapest first.
    if (this.deps.hasBlockHex(root)) return {result: "rejected", reason: "inForkChoice"};
    if (claim.slotHint !== undefined && claim.slotHint <= this.deps.finalizedSlot()) {
      // [A8] Provably nothing to sync above the floor — no walk, no penalty, no cooldown.
      return {result: "rejected", reason: "belowFloor"};
    }
    if (this.badTargets.has(root)) {
      // Refresh LRU position on hit.
      this.badTargets.delete(root);
      this.badTargets.set(root, true);
      return {result: "rejected", reason: "badTarget"};
    }
    const droppedUntil = this.recentlyDropped.get(root);
    if (droppedUntil !== undefined) {
      if (this.deps.now() < droppedUntil) return {result: "rejected", reason: "cooldown"};
      this.recentlyDropped.delete(root);
    }
    if (claim.peer !== undefined && this.advocateCount(claim.peer) >= TARGETS_PER_ADVOCATE_MAX) {
      return {result: "rejected", reason: "advocateCap"};
    }
    if (this.targets.size >= TARGET_QUEUE_MAX && !this.evictForAdmission(claim)) {
      return {result: "rejected", reason: "queueFull"};
    }

    const target: Target = {
      root,
      slotHint: claim.slotHint,
      kind: claim.kind,
      status: {kind: "queued"},
      advocates: new Map(claim.peer !== undefined ? [[claim.peer, claim.claimedRoot ?? root]] : []),
      waiters: claim.waiter !== undefined ? [claim.waiter] : [],
      headerChain: [],
      walkAnchor: root,
      provenance: new Map(),
      intersectionRoot: undefined,
      attempts: {walk: 0, import: 0},
      spillBytes: 0,
      createdAtMs: this.deps.now(),
      spill: this.deps.createSpill(root),
    };
    this.targets.set(root, target);
    this.walkedRoots.set(root, root);
    return {result: "admitted", target};
  }

  private feed(target: Target, claim: UpsertClaim): void {
    if (claim.peer !== undefined && !target.advocates.has(claim.peer)) {
      target.advocates.set(claim.peer, claim.claimedRoot ?? claim.root);
    }
    if (claim.waiter !== undefined && target.waiters.length < TARGET_WAITERS_MAX) {
      target.waiters.push(claim.waiter);
    }
    if (target.slotHint === undefined && claim.slotHint !== undefined) target.slotHint = claim.slotHint;
    // Latest classification wins — a re-STATUS can upgrade a finalized target to a head target.
    if (claim.kind !== "byRoot") target.kind = claim.kind;
  }

  private advocateCount(peer: PeerIdStr): number {
    let count = 0;
    for (const t of this.targets.values()) {
      if (t.advocates.has(peer)) count++;
    }
    return count;
  }

  /** Queued-only eviction: a new claim may displace the lowest-priority QUEUED target it outranks. */
  private evictForAdmission(claim: UpsertClaim): boolean {
    let lowest: Target | undefined;
    for (const t of this.targets.values()) {
      if (t.status.kind !== "queued") continue;
      if (lowest === undefined || comparePriority(t, lowest) > 0) lowest = t;
    }
    if (lowest === undefined) return false;
    // Outranks = strictly better kind priority than the victim.
    if (kindRank(claim.kind) >= kindRank(lowest.kind)) return false;
    this.terminal(lowest, "exhausted");
    return true;
  }

  // -------------------------------------------------------------------------
  // Walk transitions
  // -------------------------------------------------------------------------

  /**
   * Apply a walk hop outcome. `prevChainLen` is `headerChain.length` before the
   * hop (new walked roots take ownership entries from there).
   */
  onWalkResult(target: Target, res: WalkHopResult, prevChainLen: number): void {
    if (target.status.kind === "terminal") return;

    // Register ownership of newly walked roots (idempotent over reversals).
    if (target.headerChain.length !== prevChainLen) {
      for (const el of target.headerChain) {
        if (!this.walkedRoots.has(el.root)) this.walkedRoots.set(el.root, target.root);
      }
    }

    switch (res.outcome) {
      case "intersected":
        target.attempts.walk = 0;
        target.status = {kind: "importing"};
        return;

      case "progress": {
        target.attempts.walk = 0;
        // Convergence: the next anchor is owned by another LIVE target — wait for it [A4].
        const ownerRoot = this.walkedRoots.get(target.walkAnchor);
        if (ownerRoot !== undefined && ownerRoot !== target.root && this.targets.has(ownerRoot)) {
          this.assertAcyclicOwnership(target.root, ownerRoot);
          target.status = {kind: "awaitingOwner", owner: ownerRoot};
          return;
        }
        target.status = {kind: "walking"};
        return;
      }

      case "tooOld":
        this.terminal(target, "too_old");
        return;

      case "invalidChain":
        // Walk-level verdict: the whole walked chain is implicated (fault at the bottom).
        this.terminal(target, "invalid", {firstInvalidRoot: null, reason: res.reason});
        return;

      case "emptyHop": {
        target.attempts.walk++;
        if (target.attempts.walk > WALK_ATTEMPTS_MAX) {
          this.terminal(target, "exhausted");
          return;
        }
        this.park(target, "backoff", this.deps.now() + backoffMs(target.attempts.walk), "walk");
        return;
      }

      case "peerStarved": {
        // Not the chain's fault — no budget burn; retry when the ledger advises.
        const untilMs = clamp(res.retryAtMs, this.deps.now() + 1_000, this.deps.now() + BACKOFF_MAX_MS);
        this.park(target, "peerStarved", untilMs, "walk");
        return;
      }

      case "quotaExceeded":
        this.deps.logger.warn(
          "TargetSync target exceeded its spill quota — the gap is too large for backward sync; consider a fresh checkpoint sync (--checkpointSyncUrl)",
          {target: target.root}
        );
        this.terminal(target, "exhausted");
        return;

      case "aborted":
        this.terminal(target, "aborted");
        return;
    }
  }

  /** Anchor already in fork choice — the walk is done without a hop (near-head / post-owner). */
  markIntersected(target: Target): void {
    if (target.headerChain.length > 0 && target.headerChain[0].root === target.root) {
      // Newest-first (still walking shape) → flip to bottom-first for import.
      target.headerChain.reverse();
    }
    target.intersectionRoot = target.walkAnchor;
    target.attempts.walk = 0;
    target.status = {kind: "importing"};
  }

  // -------------------------------------------------------------------------
  // Import transitions (invoked by the importer driver — Phase 5)
  // -------------------------------------------------------------------------

  park(
    target: Target,
    reason: "backoff" | "awaitingParentPayload" | "awaitingData" | "elOffline" | "peerStarved",
    untilMs: number,
    resume: "walk" | "import"
  ): void {
    if (target.status.kind === "terminal") return;
    target.status = {kind: "parked", reason, untilMs, resume};
  }

  /** A failed import attempt (transient). Budget-guarded park. */
  parkImportAttempt(
    target: Target,
    reason: "backoff" | "awaitingParentPayload" | "awaitingData" | "elOffline",
    wakeDriven = false
  ): void {
    target.attempts.import++;
    if (target.attempts.import > IMPORT_ATTEMPTS_MAX) {
      this.terminal(target, "exhausted");
      return;
    }
    // Wake-driven parks (parent payload / data) still get a deadline so the per-slot
    // scan is a guaranteed backstop when the wake event is lost.
    const untilMs = this.deps.now() + (wakeDriven ? BACKOFF_MAX_MS : backoffMs(target.attempts.import));
    this.park(target, reason, untilMs, "import");
  }

  /** Fork choice moved beneath the walk (finalization advance) — rewalk from the target. */
  reanchor(target: Target): void {
    if (target.status.kind === "terminal") return;
    this.releaseWalkedRoots(target);
    target.headerChain = [];
    target.walkAnchor = target.root;
    target.intersectionRoot = undefined;
    target.provenance.clear();
    target.attempts.walk = 0;
    target.attempts.import = 0;
    this.walkedRoots.set(target.root, target.root);
    target.status = {kind: "queued"};
    void target.spill.clear(this.deps.signal).catch((e) => {
      this.deps.logger.debug("TargetSync spill clear failed on reanchor", {target: target.root}, e as Error);
    });
  }

  // -------------------------------------------------------------------------
  // Terminals (atomic release)
  // -------------------------------------------------------------------------

  terminal(
    target: Target,
    terminal: TargetTerminal,
    opts: {firstInvalidRoot?: RootHex | null; reason?: string} = {}
  ): void {
    if (target.status.kind === "terminal") return;
    target.status = {kind: "terminal", terminal};
    this.terminals[terminal]++;

    // Release ownership + live-set membership FIRST so cascades see consistent state.
    this.targets.delete(target.root);
    this.releaseWalkedRoots(target);

    switch (terminal) {
      case "completed":
        this.deps.invalidBytes.discard(target.root);
        if (target.waiters.length > 0) this.deps.onWaiters(target.waiters);
        this.deps.onCompleted(target);
        break;

      case "invalid": {
        this.rememberBadTarget(target.root);
        this.scoreAdvocatesForInvalid(target, opts.firstInvalidRoot ?? null, opts.reason ?? "invalid_chain");
        this.deps.invalidBytes.settleInvalid(target.root, (peer) =>
          this.deps.reportPeerLow(peer, "served_invalid_bytes")
        );
        this.deps.logger.warn("TargetSync target proved invalid", {
          target: target.root,
          reason: opts.reason ?? "import",
          advocates: target.advocates.size,
        });
        break;
      }

      case "too_old":
      case "exhausted":
        this.recentlyDropped.set(target.root, this.deps.now() + RECENTLY_DROPPED_MS);
        this.deps.invalidBytes.discard(target.root);
        break;

      case "superseded":
      case "aborted":
        this.deps.invalidBytes.discard(target.root);
        break;
    }

    // Spill release: async + signal-guarded; the boot wipe owns crash/close leftovers [A12].
    void target.spill.clear(this.deps.signal).catch((e) => {
      this.deps.logger.debug("TargetSync spill clear failed at terminal", {target: target.root}, e as Error);
    });

    // Dependents waiting on this owner [A4].
    for (const dep of this.targets.values()) {
      if (dep.status.kind !== "awaitingOwner" || dep.status.owner !== target.root) continue;
      switch (terminal) {
        case "completed":
          // Convergence root is now in fork choice — the dependent's walk is done.
          this.markIntersected(dep);
          break;
        case "invalid":
          // The dependent's chain INCLUDES the invalid segment below the convergence.
          this.terminal(dep, "invalid", {firstInvalidRoot: null, reason: "owner_invalid"});
          break;
        default:
          // exhausted | superseded | aborted: resume walking from the preserved cursor.
          // (The owner's spill was cleared, so the shared suffix is re-walked — bounded,
          // and simpler than transferring row ownership.)
          dep.status = {kind: "queued"};
          break;
      }
    }
  }

  /**
   * [A2] Mid only to advocates whose claimed root sits at/above the first
   * invalid block; advocates of the successfully imported prefix are
   * vindicated. `firstInvalidRoot: null` = the whole chain is implicated.
   */
  private scoreAdvocatesForInvalid(target: Target, firstInvalidRoot: RootHex | null, reason: string): void {
    let faultIndex = 0;
    if (firstInvalidRoot !== null) {
      const idx = target.headerChain.findIndex((el) => el.root === firstInvalidRoot);
      faultIndex = idx >= 0 ? idx : 0;
    }
    for (const [peer, claimedRoot] of target.advocates) {
      if (firstInvalidRoot !== null) {
        const claimedIdx = target.headerChain.findIndex((el) => el.root === claimedRoot);
        // A claimed root strictly BELOW the fault imported fine — vindicated.
        if (claimedIdx >= 0 && claimedIdx < faultIndex) continue;
      }
      this.deps.reportPeerMid(peer, `advocated_invalid:${reason}`);
    }
  }

  private rememberBadTarget(root: RootHex): void {
    this.badTargets.set(root, true);
    if (this.badTargets.size > BAD_TARGETS_MAX) {
      const oldest = this.badTargets.keys().next().value as RootHex;
      this.badTargets.delete(oldest);
    }
  }

  private releaseWalkedRoots(target: Target): void {
    for (const [root, owner] of this.walkedRoots) {
      if (owner === target.root) this.walkedRoots.delete(root);
    }
  }

  /** Debug-assert the awaitingOwner edge set stays acyclic [A4]. */
  private assertAcyclicOwnership(from: RootHex, firstOwner: RootHex): void {
    let hop = 0;
    let current: RootHex | undefined = firstOwner;
    while (current !== undefined && hop++ < this.targets.size + 1) {
      if (current === from) {
        this.deps.logger.error("TargetSync awaitingOwner cycle detected — breaking by resuming walk", {
          target: from,
          owner: firstOwner,
        });
        throw new Error("awaitingOwner cycle");
      }
      const owner: Target | undefined = this.targets.get(current);
      current = owner !== undefined && owner.status.kind === "awaitingOwner" ? owner.status.owner : undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Scheduling views
  // -------------------------------------------------------------------------

  /** Targets ready to walk (priority order), up to `max`. */
  pickWalkers(max: number): Target[] {
    const ready: Target[] = [];
    for (const t of this.targets.values()) {
      if (t.status.kind === "queued" || t.status.kind === "walking") ready.push(t);
    }
    ready.sort(comparePriority);
    return ready.slice(0, max);
  }

  /** Highest-priority target ready to import (the import slot is granted per segment [A6]). */
  pickImporter(): Target | null {
    let best: Target | null = null;
    for (const t of this.targets.values()) {
      if (t.status.kind !== "importing") continue;
      if (best === null || comparePriority(t, best) < 0) best = t;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Time-driven maintenance
  // -------------------------------------------------------------------------

  /** Per-slot scan: expire parks + sweep cooldowns (I2's liveness backstop). */
  onSlot(): void {
    const nowMs = this.deps.now();
    for (const t of this.targets.values()) {
      if (t.status.kind === "parked" && nowMs >= t.status.untilMs) {
        t.status = t.status.resume === "walk" ? {kind: "queued"} : {kind: "importing"};
      }
    }
    for (const [root, until] of this.recentlyDropped) {
      if (nowMs >= until) this.recentlyDropped.delete(root);
    }
  }

  /** Finalization advanced: drop targets that fell at/below the new floor. */
  onFinalized(finalizedSlot: Slot): void {
    for (const t of [...this.targets.values()]) {
      const tipSlot = t.headerChain.length > 0 ? t.headerChain.at(-1)?.slot : t.slotHint;
      const knownTip = tipSlot ?? t.slotHint;
      if (knownTip !== undefined && knownTip <= finalizedSlot) this.terminal(t, "too_old");
      else if (this.deps.hasBlockHex(t.root)) this.terminal(t, "completed");
    }
  }

  /** Close: every live target terminates `aborted` — no penalties, no db waits. */
  abortAll(): void {
    for (const t of [...this.targets.values()]) this.terminal(t, "aborted");
  }

  /** Walked-root ownership entries (leak observability: must be 0 when no targets live). */
  get walkedRootsCount(): number {
    return this.walkedRoots.size;
  }

  get counts(): {live: number; byStatus: Record<string, number>} {
    const byStatus: Record<string, number> = {};
    for (const t of this.targets.values()) {
      byStatus[t.status.kind] = (byStatus[t.status.kind] ?? 0) + 1;
    }
    return {live: this.targets.size, byStatus};
  }

  /** True when any live target is a finalized-range sync (SyncingFinalized derivation). */
  get hasFinalizedKind(): boolean {
    for (const t of this.targets.values()) {
      if (t.kind === "finalized") return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Priority: finalized > head > byRoot; more advocates first; older first.
// Negative = a ranks higher.
// ---------------------------------------------------------------------------

function kindRank(kind: TargetKind): number {
  switch (kind) {
    case "finalized":
      return 0;
    case "head":
      return 1;
    case "byRoot":
      return 2;
  }
}

export function comparePriority(a: Target, b: Target): number {
  const kindDiff = kindRank(a.kind) - kindRank(b.kind);
  if (kindDiff !== 0) return kindDiff;
  const advDiff = b.advocates.size - a.advocates.size;
  if (advDiff !== 0) return advDiff;
  return a.createdAtMs - b.createdAtMs;
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
