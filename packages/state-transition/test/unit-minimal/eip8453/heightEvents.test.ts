import {describe, expect, it} from "vitest";
import {FINALITY_FLAG_INDEX, PROGRESS_FLAG_INDEX, TIMEOUT_DELAY_SLOTS} from "@lodestar/params";
import {EMPTY_CHECKPOINT, Eip8453Harness, ZERO_ROOT, allValidators, range} from "./harness.js";

const N = 64;
const ALL = allValidators(N);
const PROGRESS = 1 << PROGRESS_FLAG_INDEX;
const FINALITY = 1 << FINALITY_FLAG_INDEX;

describe("eip8453 height events (scripted votes)", () => {
  it("genesis state fills the height-1 target root with the genesis block root on the first slot", () => {
    const h = new Eip8453Harness(N);
    expect(h.snapshot().target).toEqual({height: 1, root: ZERO_ROOT});
    h.advanceTo(1);
    expect(h.snapshot().target).toEqual({height: 1, root: h.genesisRoot()});
    expect(h.snapshot().targetSlot).toBe(0);
  });

  it("target quorum justifies the target, retains it as pending finality and advances the height", () => {
    const h = new Eip8453Harness(N);
    const snap = h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL})]});

    expect(snap.justified).toEqual({height: 1, root: h.genesisRoot()});
    expect(snap.pendingHeights).toEqual([1]);
    expect(snap.target).toEqual({height: 2, root: ZERO_ROOT});
    expect(snap.targetSlot).toBe(1);
    expect(snap.finalized).toEqual(EMPTY_CHECKPOINT);
    // participation reset by the advance, round flags kept for rewards
    expect(h.targetParticipation().every((p) => !p)).toBe(true);
    expect(h.progressParticipation().every((p) => !p)).toBe(true);
    expect(h.roundParticipation().every((f) => f === PROGRESS)).toBe(true);
    expect(h.state.proposerRewards.attestations).toBeGreaterThan(0);

    h.advanceTo(2);
    expect(h.snapshot().target.root).toEqual(h.blockRoot(1));
  });

  it("a partial target quorum records participation but does not advance", () => {
    const h = new Eip8453Harness(N);
    const snap = h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 40)})]});

    expect(snap.target.height).toBe(1);
    expect(snap.justified.height).toBe(0);
    expect(
      h
        .targetParticipation()
        .slice(0, 40)
        .every((p) => p)
    ).toBe(true);
    expect(
      h
        .targetParticipation()
        .slice(40)
        .every((p) => !p)
    ).toBe(true);
    expect(
      h
        .progressParticipation()
        .slice(0, 40)
        .every((p) => p)
    ).toBe(true);
  });

  it("finality quorum on the pending justification finalizes it", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL})]});
    const snap = h.produceBlock(2, {attestations: [h.vote(2, {voters: ALL, finality: "justified"})]});

    expect(snap.finalized).toEqual({height: 1, root: h.genesisRoot()});
    expect(snap.finalizedSlot).toBe(0);
    expect(snap.justified).toEqual({height: 2, root: h.blockRoot(1)});
    expect(snap.target.height).toBe(3);
    expect(snap.targetSlot).toBe(2);
    // height 1 was finalized and dropped, height 2 is the new pending justification
    expect(snap.pendingHeights).toEqual([2]);
    expect(h.roundParticipation().every((f) => f === (PROGRESS | FINALITY))).toBe(true);
  });

  it("timeouts count as progress and advance only after TIMEOUT_DELAY_SLOTS", () => {
    const h = new Eip8453Harness(N);
    let snap = h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL, timeout: true})]});

    expect(h.progressParticipation().every((p) => p)).toBe(true);
    expect(h.targetParticipation().every((p) => !p)).toBe(true);
    expect(snap.target.height).toBe(1);

    // target entered at slot 0, timeouts may only advance from slot TIMEOUT_DELAY_SLOTS
    snap = h.produceBlock(TIMEOUT_DELAY_SLOTS - 1);
    expect(snap.target.height).toBe(1);

    snap = h.produceBlock(TIMEOUT_DELAY_SLOTS);
    expect(snap.target.height).toBe(2);
    expect(snap.targetSlot).toBe(TIMEOUT_DELAY_SLOTS);
    expect(snap.justified.height).toBe(0);
    expect(snap.pendingHeights).toEqual([]);
  });

  it("a mixed quorum of target votes and timeouts advances without justifying", () => {
    const h = new Eip8453Harness(100);
    const snap = h.produceBlock(TIMEOUT_DELAY_SLOTS, {
      attestations: [
        h.vote(TIMEOUT_DELAY_SLOTS, {voters: range(0, 40)}),
        h.vote(TIMEOUT_DELAY_SLOTS, {voters: range(70, 100), timeout: true}),
      ],
    });
    expect(snap.target.height).toBe(2);
    expect(snap.justified.height).toBe(0);
  });

  it("a previous-height vote still credits a retained finality pair", () => {
    const h = new Eip8453Harness(N);
    // height 1 justified by 48 of 64, the rest did not vote
    h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 48)})]});
    // height 2 justified, with finality votes for height 1 from the same 48
    h.produceBlock(2, {attestations: [h.vote(2, {voters: range(0, 48), finality: "justified"})]});
    expect(h.snapshot().finalized.height).toBe(1);
    expect(h.snapshot().pendingHeights).toEqual([2]);
    // the late 16 vote for height 2 (now below the current height 3) naming the pending height-2 justification
    const late = h.vote(3, {
      voters: range(48, 64),
      target: {height: 2, root: h.blockRoot(1)},
      finality: {height: 2, root: h.blockRoot(1)},
    });
    expect(() => h.produceBlock(3, {attestations: [late]})).toThrow();
  });

  it("a vote below the current height with a pending finality pair below its target is includable", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 48)})]});
    h.produceBlock(2, {attestations: [h.vote(2, {voters: range(0, 48)})]});
    // target height 3 now; heights 1 and 2 are pending. A height-2 vote with finality for height 1 is valid
    const snap = h.produceBlock(3, {
      attestations: [
        h.vote(3, {
          voters: range(48, 64),
          target: {height: 2, root: h.blockRoot(1)},
          finality: {height: 1, root: h.genesisRoot()},
        }),
      ],
    });
    expect(snap.target.height).toBe(3);
    expect(
      h
        .pendingParticipation(0)
        .slice(48)
        .every((p) => p)
    ).toBe(true);
    expect(
      h
        .pendingParticipation(0)
        .slice(0, 48)
        .every((p) => !p)
    ).toBe(true);
    // below-height votes do not touch the current height's participation
    expect(h.progressParticipation().every((p) => !p)).toBe(true);
    expect(
      h
        .roundParticipation()
        .slice(48)
        .every((f) => f === FINALITY)
    ).toBe(true);
  });

  it("rejects malformed and stale attestations", () => {
    const h = new Eip8453Harness(N);
    h.advanceTo(1);
    const current = h.snapshot().target;
    // empty target root
    expect(() =>
      h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL, target: {height: 1, root: ZERO_ROOT}})]})
    ).toThrow(/Malformed/);
    // finality at or above the target height
    expect(() =>
      h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL, finality: {height: 1, root: h.genesisRoot()}})]})
    ).toThrow(/Malformed/);
    // unknown target
    expect(() =>
      h.produceBlock(1, {
        attestations: [h.vote(1, {voters: ALL, target: {height: 1, root: new Uint8Array(32).fill(9)}})],
      })
    ).toThrow(/does not match/);
    // epoch in the future
    expect(() => h.produceBlock(1, {attestations: [h.vote(1, {voters: ALL, epoch: 5})]})).toThrow(/after the current/);
    // bad signature
    const bad = h.vote(1, {voters: ALL, target: current});
    bad.signature = h.vote(1, {voters: ALL, target: current, timeout: true}).signature;
    expect(() => h.produceBlock(1, {attestations: [bad]})).toThrow(/Invalid indexed attestation/);
    // aggregation bits do not match the committees
    const short = h.vote(1, {voters: ALL, target: current});
    short.aggregationBits = short.aggregationBits.clone();
    short.aggregationBits.set(short.aggregationBits.bitLen - 1, false);
    const wrongLen = {...short, aggregationBits: short.aggregationBits.clone()};
    wrongLen.aggregationBits = Object.assign(wrongLen.aggregationBits, {bitLen: wrongLen.aggregationBits.bitLen - 1});
    expect(() => h.produceBlock(1, {attestations: [wrongLen]})).toThrow();
  });

  it("flags and proposer reward are credited once per validator and height", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 32)})]});
    const rewardFirst = h.state.proposerRewards.attestations;
    expect(rewardFirst).toBeGreaterThan(0);
    // the same 32 vote again at the same height: no new flags, no reward
    h.produceBlock(2, {attestations: [h.vote(2, {voters: range(0, 32)})]});
    expect(h.state.proposerRewards.attestations).toBe(0);
    expect(h.targetParticipation().filter((p) => p).length).toBe(32);
  });
});
