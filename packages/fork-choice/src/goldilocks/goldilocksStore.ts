import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {
  CarriedHeadVote,
  Duty,
  GoldilocksBlock,
  GoldilocksNode,
  GoldilocksOpts,
  GoldilocksProposal,
  HeadVoteSummary,
  Lock,
} from "./types.js";

/** Votes of one slot, in arrival order, with the first time each was processed */
type Bucket = {
  votes: HeadVoteSummary[];
  at: number[];
  byValidator: Map<ValidatorIndex, number[]>;
};

/** The votes a selection looks at: participants decide the denominator, supported votes add to block scores */
type View = {
  participants: HeadVoteSummary[];
  supported: HeadVoteSummary[];
};

type SupportCounts = {
  /** Seats of validators with conflicting votes; they count toward participation and toward every score */
  equivocators: number;
  /** Seats of every distinct participating validator */
  participants: number;
  /** Seats supporting a node or any of its descendants, equivocators excluded */
  subtree: Map<GoldilocksNode, number>;
};

type Frame = {
  root: GoldilocksNode;
  /** Minimum target height of a viable head */
  floor: number;
};

function voteKey(vote: HeadVoteSummary): string {
  return `${vote.root}:${vote.payloadStatus}`;
}

export function isAncestor(ancestor: GoldilocksNode, node: GoldilocksNode | null): boolean {
  for (let n = node; n !== null; n = n.parent) {
    if (n === ancestor) return true;
    if (n.slot < ancestor.slot) return false;
  }
  return false;
}

/** Two blocks conflict when neither is an ancestor of the other */
export function conflicts(a: GoldilocksNode, b: GoldilocksNode): boolean {
  return !isAncestor(a, b) && !isAncestor(b, a);
}

export function commonAncestor(a: GoldilocksNode, b: GoldilocksNode): GoldilocksNode | null {
  let x: GoldilocksNode | null = a;
  let y: GoldilocksNode | null = b;
  while (x !== null && y !== null && x !== y) {
    if (x.slot > y.slot) x = x.parent;
    else if (y.slot > x.slot) y = y.parent;
    else {
      x = x.parent;
      y = y.parent;
    }
  }
  return x === y ? x : null;
}

/**
 * The Goldilocks store. Times are ms since genesis and are passed in by the caller, so tests control the
 * clock. Every public method first runs the phases that became due, so late calls see the same view they
 * would have seen on time.
 */
export class GoldilocksStore {
  readonly slotDurationMs: number;
  readonly delta: number;
  readonly committeeSize: number;
  readonly forkSlot: Slot;
  readonly lockTtlMs: number;
  readonly slowLockStreak: number;

  readonly nodes = new Map<RootHex, GoldilocksNode>();
  finalized: GoldilocksNode;
  justified: GoldilocksNode;
  /** Finalized, justified and highest target heights seen in the tree */
  hF: number;
  hJ: number;
  hMax: number;

  private readonly pool = new Map<Slot, Bucket>();
  /** Confirmation candidate recorded per slot, null when no block had a majority */
  readonly confirmations = new Map<Slot, GoldilocksNode | null>();
  readonly locks: Lock[] = [];
  /** Blocks that met the fast threshold, most recent first, the FG source candidates */
  readonly fastConfirmed: GoldilocksNode[] = [];
  latestConfirmed: GoldilocksNode | null = null;
  readonly duty: Duty = {voteSlot: null, vote: null, fgSlot: null, fgSource: null, fgHead: null};
  /** Time up to which scheduled phases have run */
  private ticked: number;
  /** Start of the observation period; duties start after a whole slot has been observed */
  restartTime: number;

  constructor(anchor: {root: RootHex; slot: Slot; fg: GoldilocksBlock["fg"]}, now: number, opts: GoldilocksOpts) {
    this.slotDurationMs = opts.slotDurationMs;
    this.delta = opts.slotDurationMs / 4;
    this.committeeSize = opts.committeeSize;
    this.forkSlot = opts.forkSlot;
    this.lockTtlMs = (opts.lockTtlSlots ?? 4) * opts.slotDurationMs;
    this.slowLockStreak = opts.slowLockStreak ?? 3;
    const node: GoldilocksNode = {
      root: anchor.root,
      slot: anchor.slot,
      parent: null,
      children: [],
      fg: anchor.fg,
      processedAt: now,
      votes: [],
      supported: [],
    };
    this.nodes.set(anchor.root, node);
    this.finalized = node;
    this.justified = node;
    this.hF = anchor.fg.finalized.height;
    this.hJ = anchor.fg.justified.height;
    this.hMax = anchor.fg.targetHeight;
    this.ticked = now;
    this.restartTime = now;
  }

  // Time

  slotAt(now: number): Slot {
    return Math.floor(now / this.slotDurationMs);
  }

  slotStart(slot: Slot): number {
    return slot * this.slotDurationMs;
  }

  /** `Δ` of `slot`: unlock on the previous slot's votes, then record the AC voting head */
  voteTime(slot: Slot): number {
    return this.slotStart(slot) + this.delta;
  }

  /** `2Δ` of `slot`: evaluate the previous slot's confirmation and record the FG inputs */
  confirmTime(slot: Slot): number {
    return this.slotStart(slot) + 2 * this.delta;
  }

  /** `3Δ` of `slot`: cutoff of the view used by the next slot's voter */
  cutoffTime(slot: Slot): number {
    return this.slotStart(slot) + 3 * this.delta;
  }

  /** The node has observed the whole previous slot, so it may vote and propose */
  joined(slot: Slot): boolean {
    return this.restartTime <= this.slotStart(slot - 1);
  }

  restart(now: number): void {
    this.restartTime = now;
  }

  /**
   * Run every scheduled phase between the last tick and `now`, earliest first. A phase runs before any input
   * with the same timestamp, so a vote arriving exactly at a cutoff lands after it.
   */
  onTick(now: number): void {
    if (now <= this.ticked) return;
    const fromSlot = this.slotAt(this.ticked);
    const toSlot = this.slotAt(now);
    for (let slot = fromSlot; slot <= toSlot; slot++) {
      const at = this.voteTime(slot);
      if (this.due(at, now)) {
        if (this.joined(slot)) this.unlock(slot - 1, at);
        this.duty.voteSlot = slot;
        this.duty.vote = this.voteHead(slot, at);
      }
      const confirmAt = this.confirmTime(slot);
      if (this.due(confirmAt, now)) {
        this.updateConfirmation(slot - 1, confirmAt);
        this.duty.fgSlot = slot;
        this.duty.fgSource = this.fgSource();
        this.duty.fgHead = this.selectHead(this.slotView(slot, confirmAt), () => true, slot);
      }
    }
    this.ticked = now;
    // Keep only the current and previous slot of votes
    for (const slot of this.pool.keys()) {
      if (slot < toSlot - 1) this.pool.delete(slot);
    }
  }

  private due(at: number, now: number): boolean {
    return at > this.ticked && at <= now;
  }

  // Blocks

  getNode(root: RootHex): GoldilocksNode | undefined {
    return this.nodes.get(root);
  }

  inTree(node: GoldilocksNode): boolean {
    return this.nodes.get(node.root) === node;
  }

  /**
   * Add a block whose state transition succeeded. Its carried votes are recorded at `now`, its FG summary may
   * advance the justified pair, and a finalized checkpoint prunes the tree once it is an ancestor of the
   * justified block with a viable descendant.
   */
  insertBlock(block: GoldilocksBlock, now: number): GoldilocksNode {
    this.onTick(now);
    const existing = this.nodes.get(block.root);
    if (existing !== undefined) return existing;
    const parent = this.nodes.get(block.parentRoot);
    if (parent === undefined) {
      throw Error(`Unknown parent ${block.parentRoot} of block ${block.root} slot ${block.slot}`);
    }
    const node: GoldilocksNode = {
      root: block.root,
      slot: block.slot,
      parent,
      children: [],
      fg: block.fg,
      processedAt: now,
      votes: block.headVotes.map(({supported: _s, ...vote}) => vote),
      supported: block.headVotes.filter((vote) => vote.supported).map(({supported: _s, ...vote}) => vote),
    };
    parent.children.push(node);
    this.nodes.set(block.root, node);

    if (block.fg.targetHeight > this.hMax) this.hMax = block.fg.targetHeight;
    this.updateJustified(block.fg.justified);
    this.updateFinalized(block.fg.finalized);
    return node;
  }

  private updateJustified(checkpoint: {height: number; root: RootHex}): void {
    if (checkpoint.height < this.hJ) return;
    const node = this.nodes.get(checkpoint.root);
    if (node === undefined) return;
    if (checkpoint.height === this.hJ && checkpoint.root <= this.justified.root) return;
    this.justified = node;
    this.hJ = checkpoint.height;
  }

  private updateFinalized(checkpoint: {height: number; root: RootHex}): void {
    if (checkpoint.height <= this.hF) return;
    const node = this.nodes.get(checkpoint.root);
    if (node === undefined || !isAncestor(node, this.justified)) return;
    const frame = this.frame();
    const viable = this.viableTree(frame, () => true);
    if (!viable.get(node) && !isAncestor(node, frame.root)) return;
    this.finalized = node;
    this.hF = checkpoint.height;
    this.prune();
  }

  /** Make the finalized block the root and drop every other branch */
  private prune(): void {
    const root = this.finalized;
    if (root.parent !== null) {
      root.parent.children = [];
      root.parent = null;
    }
    this.nodes.clear();
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop() as GoldilocksNode;
      this.nodes.set(node.root, node);
      stack.push(...node.children);
    }
    if (!this.inTree(this.justified)) this.justified = root;
  }

  /** Remove a block and its descendants, for example after the execution layer invalidated its payload */
  remove(root: RootHex): void {
    const node = this.nodes.get(root);
    if (node === undefined || node === this.finalized) return;
    if (node.parent !== null) node.parent.children = node.parent.children.filter((child) => child !== node);
    const stack = [node];
    while (stack.length > 0) {
      const n = stack.pop() as GoldilocksNode;
      this.nodes.delete(n.root);
      stack.push(...n.children);
    }
    if (!this.inTree(this.justified)) this.justified = this.finalized;
  }

  // Votes

  /**
   * Record a head vote of the current or previous slot. A validator may have two distinct votes per slot
   * (an equivocation); receiving the same vote again keeps its first processing time.
   */
  processHeadVote(vote: HeadVoteSummary, now: number): void {
    this.onTick(now);
    const currentSlot = this.slotAt(now);
    if (vote.slot !== currentSlot && vote.slot !== currentSlot - 1) return;
    let bucket = this.pool.get(vote.slot);
    if (bucket === undefined) {
      bucket = {votes: [], at: [], byValidator: new Map()};
      this.pool.set(vote.slot, bucket);
    }
    const positions = bucket.byValidator.get(vote.validator) ?? [];
    for (const position of positions) {
      if (voteKey(bucket.votes[position]) === voteKey(vote)) return;
    }
    if (positions.length >= 2) return;
    positions.push(bucket.votes.length);
    bucket.byValidator.set(vote.validator, positions);
    bucket.votes.push(vote);
    bucket.at.push(now);
  }

  /** When both the vote and its block were processed; undefined while the block is unknown */
  private processedAt(vote: HeadVoteSummary, at: number): number | undefined {
    const node = this.nodes.get(vote.root);
    if (node === undefined || node.slot > vote.slot) return undefined;
    return Math.max(at, node.processedAt);
  }

  /** Votes of `slot` from the pool: participation from every vote, support from those whose block is known */
  private slotView(slot: Slot, supportCutoff: number, participationCutoff = Number.POSITIVE_INFINITY): View {
    const view: View = {participants: [], supported: []};
    const bucket = this.pool.get(slot);
    if (bucket === undefined) return view;
    for (let i = 0; i < bucket.votes.length; i++) {
      const vote = bucket.votes[i];
      if (bucket.at[i] < participationCutoff) view.participants.push(vote);
      const at = this.processedAt(vote, bucket.at[i]);
      if (at !== undefined && at < supportCutoff) view.supported.push(vote);
    }
    return view;
  }

  /**
   * The view of a voter at `Δ` of `slot`: the previous slot's votes received before its `3Δ` cutoff, plus the
   * votes carried by blocks of `slot`, which the proposer already judged.
   */
  private voterView(slot: Slot): View {
    const cutoff = this.cutoffTime(slot - 1);
    const view = this.slotView(slot - 1, cutoff, cutoff);
    for (const node of this.nodes.values()) {
      if (node.slot !== slot) continue;
      view.participants.push(...node.votes.filter((vote) => vote.slot === slot - 1));
      view.supported.push(...node.supported.filter((vote) => vote.slot === slot - 1 && this.nodes.has(vote.root)));
    }
    return dedupeView(view);
  }

  /** Blocks a voter at `Δ` of `slot` considers: processed before the cutoff, or of `slot` and their ancestors */
  private voterBlocks(slot: Slot): (node: GoldilocksNode) => boolean {
    const cutoff = this.cutoffTime(slot - 1);
    const late = new Set<GoldilocksNode>();
    for (const node of this.nodes.values()) {
      if (node.slot !== slot) continue;
      for (let n: GoldilocksNode | null = node; n !== null && !late.has(n); n = n.parent) late.add(n);
    }
    return (node) => node.processedAt < cutoff || late.has(node);
  }

  // Head selection

  /** The FG frame: the root every head descends from and the minimum target height of a head */
  frame(): Frame {
    const floor = Math.max(this.hMax - 1, 0);
    if (this.hMax !== this.hJ + 1) {
      return {root: this.finalized, floor};
    }
    for (const node of this.nodes.values()) {
      if (node.fg.targetHeight === this.hMax && !isAncestor(this.justified, node)) {
        return {root: this.finalized, floor: this.hMax};
      }
    }
    return {root: this.justified, floor};
  }

  private viableHead(frame: Frame, node: GoldilocksNode): boolean {
    return node.fg.targetHeight >= frame.floor;
  }

  /** Nodes under the frame root that are, or lead to, a viable head, among the blocks `include` admits */
  viableTree(frame: Frame, include: (node: GoldilocksNode) => boolean): Map<GoldilocksNode, boolean> {
    const viable = new Map<GoldilocksNode, boolean>();
    const walk = (node: GoldilocksNode, under: boolean): boolean => {
      if (!include(node)) return false;
      const isUnder = under || node === frame.root;
      let v = isUnder && this.viableHead(frame, node);
      for (const child of node.children) {
        v = walk(child, isUnder) || v;
      }
      viable.set(node, v && isUnder);
      return v;
    };
    walk(this.finalized, false);
    return viable;
  }

  countSupport(view: View, countEquivocators: boolean): SupportCounts {
    const seen = new Map<ValidatorIndex, Set<string>>();
    const seats = new Map<ValidatorIndex, number>();
    for (const vote of view.participants) {
      let keys = seen.get(vote.validator);
      if (keys === undefined) {
        keys = new Set();
        seen.set(vote.validator, keys);
        seats.set(vote.validator, vote.seats);
      }
      keys.add(voteKey(vote));
    }
    const counts: SupportCounts = {equivocators: 0, participants: 0, subtree: new Map()};
    const equivocating = new Set<ValidatorIndex>();
    for (const [validator, keys] of seen) {
      const s = seats.get(validator) ?? 0;
      counts.participants += s;
      if (keys.size > 1) {
        equivocating.add(validator);
        if (countEquivocators) counts.equivocators += s;
      }
    }
    const counted = new Set<ValidatorIndex>();
    for (const vote of view.supported) {
      if (equivocating.has(vote.validator) || counted.has(vote.validator)) continue;
      counted.add(vote.validator);
      for (let n = this.nodes.get(vote.root) ?? null; n !== null; n = n.parent) {
        counts.subtree.set(n, (counts.subtree.get(n) ?? 0) + vote.seats);
      }
    }
    return counts;
  }

  private score(counts: SupportCounts, node: GoldilocksNode): number {
    return counts.equivocators + (counts.subtree.get(node) ?? 0);
  }

  private hasMajority(counts: SupportCounts, node: GoldilocksNode): boolean {
    return counts.participants < 2 * this.score(counts, node);
  }

  /** The live lock with the highest block, walked up to the first block the frame admits; else the frame root */
  private anchor(frame: Frame, now: number): GoldilocksNode {
    let lock: Lock | null = null;
    for (const candidate of this.locks) {
      if (candidate.deadline <= now || !this.inTree(candidate.node)) continue;
      if (lock === null || candidate.node.slot > lock.node.slot) lock = candidate;
    }
    if (lock === null) return frame.root;
    const viable = this.viableTree(frame, () => true);
    for (let n: GoldilocksNode | null = lock.node; n !== null; n = n.parent) {
      if (viable.get(n)) return n;
    }
    return frame.root;
  }

  /**
   * Time-aware GHOST: from the anchor, follow the viable, eligible child with the most support, ties to the
   * greater root. A child is eligible when its parent is below the height floor, it is of the current slot or
   * before the fork, or it has a majority of the participating seats.
   */
  selectHead(
    view: View,
    include: (node: GoldilocksNode) => boolean,
    currentSlot: Slot,
    now = Number.POSITIVE_INFINITY
  ): GoldilocksNode {
    const frame = this.frame();
    const viable = this.viableTree(frame, include);
    const counts = this.countSupport(view, true);
    let head = this.anchor(frame, now);
    for (;;) {
      let best: GoldilocksNode | null = null;
      for (const child of head.children) {
        if (!viable.get(child)) continue;
        const eligible =
          !this.viableHead(frame, head) ||
          child.slot === currentSlot ||
          child.slot < this.forkSlot ||
          this.hasMajority(counts, child);
        if (!eligible) continue;
        if (
          best === null ||
          this.score(counts, child) > this.score(counts, best) ||
          (this.score(counts, child) === this.score(counts, best) && child.root > best.root)
        ) {
          best = child;
        }
      }
      if (best === null) return head;
      head = best;
    }
  }

  /** The head at `now`: before `2Δ` of the current slot the previous slot's votes decide, after it the current slot's */
  head(now: number): GoldilocksNode {
    this.onTick(now);
    const slot = this.slotAt(now);
    const voteSlot = now < this.confirmTime(slot) ? slot - 1 : slot;
    return this.selectHead(this.slotView(voteSlot, now), () => true, slot, now);
  }

  /** The AC voting head recorded at `Δ` of `slot` */
  private voteHead(slot: Slot, at: number): GoldilocksNode {
    return this.selectHead(this.voterView(slot), this.voterBlocks(slot), slot, at);
  }

  /** The recorded AC vote of `slot`, if the node had joined and the block is still in the tree */
  vote(slot: Slot, now: number): GoldilocksNode | null {
    this.onTick(now);
    if (this.duty.voteSlot !== slot || this.duty.vote === null || !this.inTree(this.duty.vote)) return null;
    return this.duty.vote;
  }

  /** The FG source and head recorded at `2Δ` of `slot` */
  fgInputs(slot: Slot, now: number): {source: GoldilocksNode; head: GoldilocksNode} | null {
    this.onTick(now);
    if (this.duty.fgSlot !== slot || this.duty.fgSource === null || this.duty.fgHead === null) return null;
    if (!this.inTree(this.duty.fgSource) || !this.inTree(this.duty.fgHead)) return null;
    return {source: this.duty.fgSource, head: this.duty.fgHead};
  }

  /** First fast-confirmed block still in the tree and admitted by the frame; the finalized block otherwise */
  private fgSource(): GoldilocksNode {
    const viable = this.viableTree(this.frame(), () => true);
    for (const node of this.fastConfirmed) {
      if (this.inTree(node) && viable.get(node)) return node;
    }
    return this.finalized;
  }

  /** The parent of a block at `slot` and the previous slot's votes to carry, judged by the proposer's view */
  proposal(slot: Slot, now: number): GoldilocksProposal {
    this.onTick(now);
    const view = this.slotView(slot - 1, now);
    const parent = this.selectHead(view, () => true, slot, now);
    const supported = new Set(view.supported.map((vote) => `${vote.validator}:${voteKey(vote)}`));
    const headVotes: CarriedHeadVote[] = view.participants.map((vote) => ({
      ...vote,
      supported: supported.has(`${vote.validator}:${voteKey(vote)}`),
    }));
    return {parent, headVotes};
  }

  // Confirmation and locks

  /**
   * At `2Δ` of the slot after `slot`: participation counts every vote of `slot` received by now, support only
   * votes whose vote and block were both processed before `2Δ` of `slot`. Confirmation is GHOST from the
   * finalized block with a majority at every step and no height floor; equivocators participate but support
   * nothing. A live lock on a conflicting branch vetoes the lock, not the record.
   */
  private updateConfirmation(slot: Slot, now: number): void {
    const view = this.slotView(slot, this.confirmTime(slot), now);
    const counts = this.countSupport(view, false);
    let candidate: GoldilocksNode | null = null;
    let node = this.finalized;
    for (;;) {
      let best: GoldilocksNode | null = null;
      for (const child of node.children) {
        if (!this.hasMajority(counts, child)) continue;
        if (best === null || this.score(counts, child) > this.score(counts, best)) best = child;
      }
      if (best === null) break;
      node = best;
      candidate = node;
    }
    if (candidate === null && this.hasMajority(counts, this.finalized)) candidate = this.finalized;
    this.confirmations.set(slot, candidate);
    if (candidate === null || this.vetoed(candidate, now)) return;
    this.advance(candidate, counts, slot, now);
  }

  private vetoed(candidate: GoldilocksNode, now: number): boolean {
    return this.locks.some((lock) => lock.deadline > now && this.inTree(lock.node) && conflicts(lock.node, candidate));
  }

  /** Common ancestor of the last `slowLockStreak` candidates; a missing candidate breaks the streak */
  private streakAncestor(slot: Slot): GoldilocksNode | null {
    let ancestor: GoldilocksNode | null = null;
    for (let s = slot; s > slot - this.slowLockStreak; s--) {
      const candidate = this.confirmations.get(s);
      if (candidate === null || candidate === undefined || !this.inTree(candidate)) return null;
      ancestor = ancestor === null ? candidate : commonAncestor(ancestor, candidate);
      if (ancestor === null) return null;
    }
    return ancestor;
  }

  /**
   * Walk from the candidate to the finalized block: a block with at least half the committee's seats is fast
   * confirmed (an FG source candidate), the streak ancestor is slow confirmed, and the first of either is
   * locked.
   */
  private advance(candidate: GoldilocksNode, counts: SupportCounts, slot: Slot, now: number): void {
    this.latestConfirmed = candidate;
    const streak = this.streakAncestor(slot);
    let slow = false;
    let locked: GoldilocksNode | null = null;
    const fast: GoldilocksNode[] = [];
    for (let n: GoldilocksNode | null = candidate; n !== null; n = n.parent) {
      const isFast = 2 * this.score(counts, n) >= this.committeeSize;
      if (isFast) fast.push(n);
      slow = slow || n === streak;
      if (locked === null && (isFast || slow)) locked = n;
    }
    this.fastConfirmed.unshift(...fast);
    if (locked !== null) {
      this.locks.push({node: locked, deadline: now + this.lockTtlMs});
    }
    // Drop expired or pruned locks and old fast confirmations
    for (let i = this.locks.length - 1; i >= 0; i--) {
      if (this.locks[i].deadline <= now || !this.inTree(this.locks[i].node)) this.locks.splice(i, 1);
    }
    for (
      let last = this.fastConfirmed.at(-1);
      last !== undefined && !this.inTree(last);
      last = this.fastConfirmed.at(-1)
    ) {
      this.fastConfirmed.pop();
    }
  }

  /**
   * At `Δ` of the slot after `slot`: move each live lock toward the finalized block while at least half the
   * committee's seats, counted from votes of `slot` whose vote and block were processed before now, voted for
   * blocks conflicting with the locked block. Equivocators are excluded. Deadlines are unchanged.
   */
  private unlock(slot: Slot, now: number): void {
    const view = this.slotView(slot, now, now);
    const equivocating = new Set<ValidatorIndex>();
    const seen = new Map<ValidatorIndex, string>();
    for (const vote of view.participants) {
      const prev = seen.get(vote.validator);
      if (prev !== undefined && prev !== voteKey(vote)) equivocating.add(vote.validator);
      seen.set(vote.validator, voteKey(vote));
    }
    for (const lock of this.locks) {
      if (lock.deadline <= now || !this.inTree(lock.node)) continue;
      while (lock.node !== this.finalized) {
        let conflicting = 0;
        const counted = new Set<ValidatorIndex>();
        for (const vote of view.supported) {
          if (equivocating.has(vote.validator) || counted.has(vote.validator)) continue;
          const target = this.nodes.get(vote.root);
          if (target === undefined || !conflicts(target, lock.node)) continue;
          counted.add(vote.validator);
          conflicting += vote.seats;
        }
        if (2 * conflicting < this.committeeSize) break;
        lock.node = lock.node.parent ?? this.finalized;
      }
    }
  }

  /** The latest confirmed block restricted to the current head's chain */
  confirmed(now: number): GoldilocksNode {
    const head = this.head(now);
    if (this.latestConfirmed === null || !this.inTree(this.latestConfirmed)) return this.finalized;
    return commonAncestor(this.latestConfirmed, head) ?? this.finalized;
  }

  liveLocks(now: number): GoldilocksNode[] {
    return this.locks.filter((lock) => lock.deadline > now && this.inTree(lock.node)).map((lock) => lock.node);
  }
}

/** Remove duplicate votes but keep conflicting ones so equivocation stays visible */
function dedupeView(view: View): View {
  const dedupe = (votes: HeadVoteSummary[]): HeadVoteSummary[] => {
    const seen = new Set<string>();
    const out: HeadVoteSummary[] = [];
    for (const vote of votes) {
      const key = `${vote.validator}:${voteKey(vote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(vote);
    }
    return out;
  };
  return {participants: dedupe(view.participants), supported: dedupe(view.supported)};
}
