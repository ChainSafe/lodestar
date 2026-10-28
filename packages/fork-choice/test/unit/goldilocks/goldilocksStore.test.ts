import {beforeEach, describe, expect, it} from "vitest";
import {FgSummary, GoldilocksBlock, GoldilocksStore, HeadVoteSummary} from "../../../src/goldilocks/index.js";

const SLOT_MS = 1000;
const DELTA = SLOT_MS / 4;
const COMMITTEE = 16;
const PENDING = 2;
const FULL = 1;

const fg = (
  targetHeight = 1,
  justified = {height: 0, root: "0xg"},
  finalized = {height: 0, root: "0xg"}
): FgSummary => ({
  targetHeight,
  justified,
  finalized,
});

/** `at(slot, k)` is `kΔ` into `slot` */
const at = (slot: number, k: number): number => slot * SLOT_MS + k * DELTA;

function block(root: string, slot: number, parentRoot: string, opts: Partial<GoldilocksBlock> = {}): GoldilocksBlock {
  return {root, slot, parentRoot, fg: opts.fg ?? fg(), headVotes: opts.headVotes ?? []};
}

function vote(validator: number, slot: number, root: string, payloadStatus = PENDING, seats = 1): HeadVoteSummary {
  return {validator, slot, root, payloadStatus, seats};
}

/** Votes from validators `[from, to)` for `root` at `slot` */
function votes(from: number, to: number, slot: number, root: string, payloadStatus = PENDING): HeadVoteSummary[] {
  return Array.from({length: to - from}, (_, i) => vote(from + i, slot, root, payloadStatus));
}

describe("GoldilocksStore", () => {
  let store: GoldilocksStore;

  beforeEach(() => {
    store = new GoldilocksStore({root: "0xg", slot: 0, fg: fg(1)}, 0, {
      slotDurationMs: SLOT_MS,
      committeeSize: COMMITTEE,
      forkSlot: 0,
      lockTtlSlots: 4,
      slowLockStreak: 3,
    });
  });

  it("follows a linear chain and switches from previous-slot votes to current-slot votes at 2Δ", () => {
    store.insertBlock(block("0xa", 1, "0xg"), at(1, 0));
    for (const v of votes(0, 16, 1, "0xa")) store.processHeadVote(v, at(1, 1));
    store.insertBlock(block("0xb", 2, "0xa"), at(2, 0));
    // Before 2Δ of slot 2 the votes of slot 1 decide: 0xa has every seat, 0xb is of the current slot so it is eligible
    expect(store.head(at(2, 1)).root).toBe("0xb");
    for (const v of votes(0, 16, 2, "0xb")) store.processHeadVote(v, at(2, 1));
    expect(store.head(at(2, 2)).root).toBe("0xb");
    expect(store.head(at(3, 0)).root).toBe("0xb");
  });

  it("picks the fork with the majority of seats, and breaks ties by the greater root", () => {
    store.insertBlock(block("0xa", 1, "0xg"), at(1, 0));
    store.insertBlock(block("0xb", 1, "0xg"), at(1, 0));
    // 7 of 13 participating seats: a majority for 0xa, but short of the 8 seats that would lock it
    for (const v of votes(0, 7, 1, "0xa")) store.processHeadVote(v, at(1, 1));
    for (const v of votes(7, 13, 1, "0xb")) store.processHeadVote(v, at(1, 1));
    expect(store.head(at(2, 1)).root).toBe("0xa");

    // A non-current-slot child without a majority is not eligible: the head stays at the parent
    store.insertBlock(block("0xc", 1, "0xg"), at(2, 2));
    for (const v of votes(0, 5, 2, "0xc")) store.processHeadVote(v, at(2, 3));
    for (const v of votes(5, 10, 2, "0xa")) store.processHeadVote(v, at(2, 3));
    for (const v of votes(10, 16, 2, "0xb")) store.processHeadVote(v, at(2, 3));
    expect(store.head(at(2, 3)).root).toBe("0xg");

    // Equal support and both eligible as current-slot blocks: the greater root wins
    store.insertBlock(block("0xd", 3, "0xa"), at(3, 0));
    store.insertBlock(block("0xe", 3, "0xa"), at(3, 0));
    for (const v of votes(0, 16, 3, "0xa")) store.processHeadVote(v, at(3, 2));
    expect(store.head(at(3, 3)).root).toBe("0xe");
  });

  it("counts an equivocating validator toward participation and every score, but never as support", () => {
    store.insertBlock(block("0xa", 1, "0xg"), at(1, 0));
    store.insertBlock(block("0xb", 1, "0xg"), at(1, 0));
    for (const v of votes(0, 8, 1, "0xa")) store.processHeadVote(v, at(1, 1));
    for (const v of votes(8, 15, 1, "0xb")) store.processHeadVote(v, at(1, 1));
    // validator 15 votes for both blocks, the second time with another payload status
    store.processHeadVote(vote(15, 1, "0xa"), at(1, 1));
    store.processHeadVote(vote(15, 1, "0xb", FULL), at(1, 1));
    const counts = store.countSupport(
      {participants: votes(0, 16, 1, "0xa"), supported: [...votes(0, 8, 1, "0xa"), ...votes(8, 16, 1, "0xb")]},
      true
    );
    expect(counts.participants).toBe(16);
    // 0xa: 8 supporters plus the equivocator's seat; 0xb: 7 plus the seat. 2 * 9 > 16 is a majority for 0xa only
    expect(store.head(at(2, 1)).root).toBe("0xa");
  });

  it("confirms a block with half the committee, locks it, and lets the lock veto and anchor", () => {
    store.insertBlock(block("0xa", 1, "0xg"), at(1, 0));
    for (const v of votes(0, 12, 1, "0xa")) store.processHeadVote(v, at(1, 1));
    // A conflicting branch arrives in slot 2 and wins a majority of its votes before 2Δ (7 of 13 seats), but
    // fewer than the 8 conflicting seats that would move the lock
    store.insertBlock(block("0xb", 2, "0xg"), at(2, 0));
    for (const v of votes(0, 7, 2, "0xb")) store.processHeadVote(v, at(2, 1));
    for (const v of votes(7, 13, 2, "0xa")) store.processHeadVote(v, at(2, 1));
    // 2Δ of slot 2 evaluates slot 1: 12 of 16 seats support 0xa, fast threshold is 8
    store.onTick(at(2, 2));
    expect(store.confirmations.get(1)?.root).toBe("0xa");
    expect(store.liveLocks(at(2, 2)).map((n) => n.root)).toEqual(["0xa"]);
    expect(store.fgInputs(2, at(2, 2))?.source.root).toBe("0xa");

    // 2Δ of slot 3 evaluates slot 2: 0xb is the candidate, but the live lock on 0xa vetoes a new lock
    store.onTick(at(3, 2));
    expect(store.confirmations.get(2)?.root).toBe("0xb");
    expect(store.liveLocks(at(3, 2)).map((n) => n.root)).toEqual(["0xa"]);
    // the lock anchors head selection on 0xa even though 0xb drew more votes
    expect(store.head(at(3, 2)).root).toBe("0xa");
    expect(store.confirmed(at(3, 2)).root).toBe("0xa");
  });

  it("moves a lock back to the parent when half the committee votes for a conflicting branch", () => {
    store.insertBlock(block("0xa", 1, "0xg"), at(1, 0));
    for (const v of votes(0, 12, 1, "0xa")) store.processHeadVote(v, at(1, 1));
    store.onTick(at(2, 2));
    expect(store.liveLocks(at(2, 2)).map((n) => n.root)).toEqual(["0xa"]);

    store.insertBlock(block("0xb", 2, "0xg"), at(2, 2));
    for (const v of votes(0, 8, 2, "0xb")) store.processHeadVote(v, at(2, 2));
    // Δ of slot 3 unlocks on the votes of slot 2: 8 seats conflict with 0xa, half the committee
    store.onTick(at(3, 1));
    expect(store.liveLocks(at(3, 1)).map((n) => n.root)).toEqual(["0xg"]);
    expect(store.vote(3, at(3, 1))?.root).toBe("0xb");
  });

  it("keeps the frame on the justified block and drops branches below the height floor", () => {
    // 0xa justifies height 1 and targets height 2: hMax = hJ + 1, so the frame root is the justified block
    store.insertBlock(block("0xa", 1, "0xg", {fg: fg(2, {height: 1, root: "0xa"})}), at(1, 0));
    store.insertBlock(block("0xb", 2, "0xa", {fg: fg(2, {height: 1, root: "0xa"})}), at(2, 0));
    // 0xc hangs off genesis with a stale target height: below the floor, not viable
    store.insertBlock(block("0xc", 2, "0xg", {fg: fg(1)}), at(2, 0));
    expect(store.justified.root).toBe("0xa");
    expect(store.frame().root.root).toBe("0xa");
    expect(store.frame().floor).toBe(1);
    for (const v of votes(0, 16, 2, "0xc")) store.processHeadVote(v, at(2, 1));
    expect(store.head(at(2, 2)).root).toBe("0xb");

    // A competing branch outside the justified block that also reaches hMax sends the frame back to finalized
    store.insertBlock(block("0xd", 3, "0xc", {fg: fg(2, {height: 1, root: "0xd"})}), at(3, 0));
    expect(store.frame().root.root).toBe("0xg");
    expect(store.frame().floor).toBe(2);
  });

  it("prunes on finalization and forgets locks on pruned branches", () => {
    store.insertBlock(block("0xa", 1, "0xg", {fg: fg(2, {height: 1, root: "0xa"})}), at(1, 0));
    store.insertBlock(block("0xb", 1, "0xg"), at(1, 0));
    for (const v of votes(0, 12, 1, "0xb")) store.processHeadVote(v, at(1, 1));
    store.onTick(at(2, 2));
    expect(store.liveLocks(at(2, 2)).map((n) => n.root)).toEqual(["0xb"]);
    store.insertBlock(
      block("0xc", 2, "0xa", {fg: fg(3, {height: 2, root: "0xc"}, {height: 1, root: "0xa"})}),
      at(2, 2)
    );
    expect(store.finalized.root).toBe("0xa");
    expect(store.getNode("0xb")).toBeUndefined();
    expect(store.liveLocks(at(2, 3))).toEqual([]);
    expect(store.head(at(2, 3)).root).toBe("0xc");
  });

  it("builds a proposal from the previous slot's votes with the proposer's support judgement", () => {
    store.insertBlock(block("0xa", 1, "0xg"), at(1, 0));
    for (const v of votes(0, 10, 1, "0xa")) store.processHeadVote(v, at(1, 1));
    // a vote for a block the store never saw participates but is not supported
    store.processHeadVote(vote(10, 1, "0xunknown"), at(1, 1));
    const proposal = store.proposal(2, at(2, 0));
    expect(proposal.parent.root).toBe("0xa");
    expect(proposal.headVotes).toHaveLength(11);
    expect(proposal.headVotes.filter((v) => v.supported).map((v) => v.validator)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(proposal.headVotes.find((v) => v.validator === 10)?.supported).toBe(false);
  });

  it("gives a voter the previous slot's votes before the 3Δ cutoff plus the votes carried in current-slot blocks", () => {
    store.insertBlock(block("0xa", 1, "0xg"), at(1, 0));
    store.insertBlock(block("0xb", 1, "0xg"), at(1, 0));
    for (const v of votes(0, 6, 1, "0xa")) store.processHeadVote(v, at(1, 1));
    // these arrive after the voter cutoff and are only visible through the block that carries them
    for (const v of votes(6, 16, 1, "0xb")) store.processHeadVote(v, at(1, 3));
    store.insertBlock(
      block("0xc", 2, "0xb", {headVotes: votes(6, 16, 1, "0xb").map((v) => ({...v, supported: true}))}),
      at(2, 0)
    );
    store.onTick(at(2, 1));
    expect(store.vote(2, at(2, 1))?.root).toBe("0xc");
  });

  it("walks past the fork-slot block nobody could vote for, instead of voting the anchor forever", () => {
    // Activated mid-slot 5 by the first post-fork block (slot 5); the anchor is the last pre-fork block
    const late = new GoldilocksStore({root: "0xg", slot: 4, fg: fg(1)}, at(5, 0.5), {
      slotDurationMs: SLOT_MS,
      committeeSize: COMMITTEE,
      forkSlot: 5,
    });
    late.insertBlock(block("0xa", 5, "0xg"), at(5, 0.6));
    late.insertBlock(block("0xb", 6, "0xa"), at(6, 0.2));
    // No vote of slot 5 exists, but 0xa is a bootstrap-slot block, so the voter at Δ of slot 6 reaches 0xb
    expect(late.vote(6, at(6, 1))?.root).toBe("0xb");
    for (const v of votes(0, 16, 6, "0xb")) late.processHeadVote(v, at(6, 1));
    late.insertBlock(block("0xc", 7, "0xb"), at(7, 0.2));
    expect(late.vote(7, at(7, 1))?.root).toBe("0xc");
    expect(late.fgInputs(7, at(7, 2))?.source.root).toBe("0xb");
  });
});
