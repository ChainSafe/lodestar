import {describe, expect, it} from "vitest";
import {EMPTY_HEIGHT, SLOTS_PER_ROUND, TIMEOUT_DELAY_ROUNDS} from "@lodestar/params";
import {FINALITY_FLAG, PROGRESS_FLAG, TARGET_FLAG} from "../../../src/util/decoupled.js";
import {DcHarness, ZERO_ROOT, allValidators, range} from "./harness.js";

const N = 64;
const ALL = allValidators(N);

describe("decoupled height events (scripted votes)", () => {
  it("genesis state fills the height-1 target root with the genesis block root on the first slot", () => {
    const h = new DcHarness(N);
    expect(h.snapshot().target).toEqual({height: 1, root: ZERO_ROOT});
    h.advanceTo(1);
    expect(h.snapshot().target).toEqual({height: 1, root: h.genesisRoot()});
    expect(h.snapshot().targetSlot).toBe(0);
  });

  it("target quorum justifies the target and advances the height", () => {
    const h = new DcHarness(N);
    const attestation = h.vote(1, {voters: ALL, target: "current"});
    const snap = h.produceBlock(1, {attestations: [attestation]});

    expect(snap.justified).toEqual({height: 1, root: h.genesisRoot()});
    expect(snap.justifiedSlot).toBe(0);
    expect(snap.target.height).toBe(2);
    expect(snap.target.root).toEqual(ZERO_ROOT);
    expect(snap.targetSlot).toBe(1);
    expect(snap.finalized).toEqual({height: 0, root: ZERO_ROOT});
    // all flags reset by the justification
    expect(h.heightParticipation().every((f) => f === 0)).toBe(true);

    h.advanceTo(2);
    expect(h.snapshot().target.root).toEqual(h.blockRoot(1));
  });

  it("a partial target quorum sets flags but does not advance", () => {
    const h = new DcHarness(N);
    const attestation = h.vote(1, {voters: range(0, 40), target: "current"});
    const snap = h.produceBlock(1, {attestations: [attestation]});

    expect(snap.target.height).toBe(1);
    expect(snap.justified.height).toBe(0);
    const flags = h.heightParticipation();
    expect(flags.slice(0, 40).every((f) => f === (TARGET_FLAG | PROGRESS_FLAG))).toBe(true);
    expect(flags.slice(40).every((f) => f === 0)).toBe(true);
  });

  it("finality quorum finalizes the justified pair", () => {
    const h = new DcHarness(N);
    h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL, target: "current"})]});
    const snap = h.produceBlock(2, {
      attestations: [h.vote(2, {voters: ALL, target: "current", finalize: "justified"})],
    });

    expect(snap.finalized).toEqual({height: 1, root: h.genesisRoot()});
    expect(snap.finalizedSlot).toBe(0);
    expect(snap.justified).toEqual({height: 2, root: h.blockRoot(1)});
    expect(snap.justifiedSlot).toBe(1);
    expect(snap.target.height).toBe(3);
    expect(snap.targetSlot).toBe(2);
  });

  it("finality quorum alone finalizes without advancing the height", () => {
    const h = new DcHarness(N);
    h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL, target: "current"})]});
    const snap = h.produceBlock(2, {
      attestations: [h.vote(2, {voters: ALL, target: "none", finalize: "justified"})],
    });

    expect(snap.finalized).toEqual({height: 1, root: h.genesisRoot()});
    expect(snap.justified.height).toBe(1);
    expect(snap.target.height).toBe(2);
    expect(h.heightParticipation().every((f) => f === FINALITY_FLAG)).toBe(true);
  });

  it("progress quorum advances without justifying and keeps finality flags, after the timeout delay", () => {
    const h = new DcHarness(N);
    // finality votes for the (height 0) justified pair set FINALITY flags without finalizing anything
    const attestation = h.vote(1, {voters: ALL, target: "empty", finalize: "justified"});
    let snap = h.produceBlock(1, {attestations: [attestation]});

    expect(h.heightParticipation().every((f) => f === (PROGRESS_FLAG | FINALITY_FLAG))).toBe(true);
    // guard: target entered at slot 0, progress may only advance from slot TIMEOUT_DELAY_ROUNDS * SLOTS_PER_ROUND
    expect(snap.target.height).toBe(1);

    const delaySlots = TIMEOUT_DELAY_ROUNDS * SLOTS_PER_ROUND;
    snap = h.produceBlock(delaySlots - 1);
    expect(snap.target.height).toBe(1);

    snap = h.produceBlock(delaySlots);
    expect(snap.target.height).toBe(2);
    expect(snap.targetSlot).toBe(delaySlots);
    expect(snap.justified.height).toBe(0);
    expect(h.heightParticipation().every((f) => f === FINALITY_FLAG)).toBe(true);
  });

  it("progress quorum advances immediately with the timeout guard disabled", () => {
    const h = new DcHarness(N);
    const snap = h.produceBlock(1, {
      attestations: [h.vote(1, {voters: ALL, target: "empty"})],
      timeoutDelayRounds: 0,
    });
    expect(snap.target.height).toBe(2);
    expect(snap.justified.height).toBe(0);
  });

  it("early advance: 30 faulty timeouts plus 40 honest target votes of 100 advance only when the guard is off", () => {
    const honestTarget = range(0, 40);
    const faulty = range(70, 100);

    const withGuard = new DcHarness(100);
    const guarded = withGuard.produceBlock(1, {
      attestations: [
        withGuard.vote(1, {voters: honestTarget, target: "current"}),
        withGuard.vote(1, {voters: faulty, target: "empty"}),
      ],
    });
    expect(guarded.target.height).toBe(1);
    expect(guarded.justified.height).toBe(0);

    const withoutGuard = new DcHarness(100);
    const unguarded = withoutGuard.produceBlock(1, {
      attestations: [
        withoutGuard.vote(1, {voters: honestTarget, target: "current"}),
        withoutGuard.vote(1, {voters: faulty, target: "empty"}),
      ],
      timeoutDelayRounds: 0,
    });
    expect(unguarded.target.height).toBe(2);
    expect(unguarded.justified.height).toBe(0);
  });

  it("votes for the previous height count in round participation only", () => {
    const h = new DcHarness(N);
    // 54 of 64 justify height 1, validators 0..9 did not vote yet
    h.produceBlock(1, {attestations: [h.vote(1, {voters: range(10, N), target: "current"})]});
    const justified = h.snapshot().justified;
    expect(justified.height).toBe(1);
    expect(
      h
        .currentRoundParticipation()
        .slice(0, 10)
        .every((f) => f === 0)
    ).toBe(true);

    const late = h.vote(2, {voters: range(0, 10), target: justified});
    const snap = h.produceBlock(2, {attestations: [late]});

    expect(snap.target.height).toBe(2);
    expect(h.heightParticipation().every((f) => f === 0)).toBe(true);
    const round = h.currentRoundParticipation();
    expect(round.slice(0, 10).every((f) => f === (TARGET_FLAG | PROGRESS_FLAG))).toBe(true);
  });

  it("previous-round attestations are accepted and land in previous round participation", () => {
    const h = new DcHarness(N);
    h.advanceTo(SLOTS_PER_ROUND - 1);
    const previousRound = h.vote(SLOTS_PER_ROUND + 1, {voters: range(0, 8), round: 0, target: "current"});
    h.produceBlock(SLOTS_PER_ROUND + 1, {attestations: [previousRound]});

    expect(
      h
        .previousRoundParticipation()
        .slice(0, 8)
        .every((f) => f === (TARGET_FLAG | PROGRESS_FLAG))
    ).toBe(true);
    expect(h.currentRoundParticipation().every((f) => f === 0)).toBe(true);
    expect(
      h
        .heightParticipation()
        .slice(0, 8)
        .every((f) => f === (TARGET_FLAG | PROGRESS_FLAG))
    ).toBe(true);
  });

  it("attestations older than the previous round are rejected", () => {
    const h = new DcHarness(N);
    const stale = h.vote(2 * SLOTS_PER_ROUND + 1, {voters: range(0, 8), round: 0, target: "current"});
    expect(() => h.produceBlock(2 * SLOTS_PER_ROUND + 1, {attestations: [stale]})).toThrow(
      /Invalid decoupled attestation data/
    );
  });

  it("round boundary rotates round participation", () => {
    const h = new DcHarness(N);
    h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 8), target: "current"})]});
    expect(
      h
        .currentRoundParticipation()
        .slice(0, 8)
        .every((f) => f !== 0)
    ).toBe(true);
    h.advanceTo(SLOTS_PER_ROUND);
    expect(
      h
        .previousRoundParticipation()
        .slice(0, 8)
        .every((f) => f !== 0)
    ).toBe(true);
    expect(h.currentRoundParticipation().every((f) => f === 0)).toBe(true);
    // height participation survives the round boundary
    expect(
      h
        .heightParticipation()
        .slice(0, 8)
        .every((f) => f !== 0)
    ).toBe(true);
  });

  it("rejects an attestation with both pairs empty", () => {
    const h = new DcHarness(N);
    const empty = h.vote(1, {voters: range(0, 8), target: "none", finalize: "none"});
    expect(empty.data.targetPair.height).toBe(EMPTY_HEIGHT);
    expect(() => h.produceBlock(1, {attestations: [empty]})).toThrow(/Invalid decoupled attestation data/);
  });

  it("rejects an attestation signed under the wrong domain", () => {
    const h = new DcHarness(N);
    const attestation = h.vote(1, {voters: range(0, 8), target: "current"});
    attestation.signature = h.vote(1, {voters: range(0, 8), target: "empty"}).signature;
    expect(() => h.produceBlock(1, {attestations: [attestation]})).toThrow(/Invalid decoupled indexed attestation/);
  });
});
