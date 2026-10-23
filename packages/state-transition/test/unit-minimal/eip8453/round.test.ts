import {describe, expect, it} from "vitest";
import {PROGRESS_FLAG_INDEX, SLOTS_PER_ROUND} from "@lodestar/params";
import {Eip8453Harness, range} from "./harness.js";

const N = 64;
const PROGRESS = 1 << PROGRESS_FLAG_INDEX;

describe("eip8453 round processing", () => {
  it("pays progress rewards at the round boundary and tracks inactivity of absent validators", () => {
    const h = new Eip8453Harness(N);
    const {INACTIVITY_SCORE_BIAS} = h.config;
    // 48 of 64 vote for the target in round 0, enough for a quorum
    h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 48)})]});
    const balancesBefore = h.state.balances.getAll();
    expect(
      h
        .roundParticipation()
        .slice(0, 48)
        .every((f) => f === PROGRESS)
    ).toBe(true);

    // cross into round 1
    h.advanceTo(SLOTS_PER_ROUND);
    const balancesAfter = h.state.balances.getAll();
    const scores = h.state.inactivityScores.getAll();
    for (let i = 0; i < N; i++) {
      if (i < 48) {
        expect(balancesAfter[i]).toBeGreaterThan(balancesBefore[i]);
        expect(scores[i]).toBe(0);
      } else {
        expect(balancesAfter[i]).toBe(balancesBefore[i]);
        expect(scores[i]).toBe(INACTIVITY_SCORE_BIAS);
      }
    }
    // the height advanced at slot 1, so progress at the new height is empty and the new round starts clean
    expect(h.roundParticipation().every((f) => f === 0)).toBe(true);
  });

  it("carries progress made at a height that lasts across rounds into the new round", () => {
    const h = new Eip8453Harness(N);
    // 32 of 64 vote for the target: no quorum, height 1 lasts
    h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 32)})]});
    h.advanceTo(SLOTS_PER_ROUND);
    const flags = h.roundParticipation();
    expect(flags.slice(0, 32).every((f) => f === PROGRESS)).toBe(true);
    expect(flags.slice(32).every((f) => f === 0)).toBe(true);
    // scores of the absent half rose, and the present half recovered to zero
    const scores = h.state.inactivityScores.getAll();
    expect(scores.slice(0, 32).every((s) => s === 0)).toBe(true);
    expect(scores.slice(32).every((s) => s === h.config.INACTIVITY_SCORE_BIAS)).toBe(true);
  });

  it("quorums weigh validators by inactivity score", () => {
    const h = new Eip8453Harness(N);
    // 43 of 64 is a quorum by count (43*3 = 129 >= 128)
    expect(h.produceBlock(1, {attestations: [h.vote(1, {voters: range(0, 43)})]}).target.height).toBe(2);
    // give the first 43 validators a large inactivity score: their weight drops below the quorum
    const h2 = new Eip8453Harness(N);
    const scores = h2.state.inactivityScores.getAll();
    for (let i = 0; i < 43; i++) scores[i] = 32768;
    h2.state.inactivityScores = h2.state.type.fields.inactivityScores.toViewDU(scores);
    h2.state.commit();
    expect(h2.produceBlock(1, {attestations: [h2.vote(1, {voters: range(0, 43)})]}).target.height).toBe(1);
  });
});
