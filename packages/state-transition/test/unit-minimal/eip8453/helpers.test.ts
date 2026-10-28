import {describe, expect, it} from "vitest";
import {
  ATTESTATION_COMMITTEES_PER_ROUND,
  EJECTION_INACTIVITY_SCORE,
  HEAD_VOTE_COMMITTEE_SIZE,
  INCLUSION_LIST_COMMITTEE_SIZE,
  SLOTS_PER_ROUND,
} from "@lodestar/params";
import {
  computeAttestationCommitteeSlot,
  computeRoundAtSlot,
  computeStartSlotAtRound,
  getAttestationCommittee,
  getAttestationCommitteeAssignment,
  getHeadVoteCommittee,
  getInclusionListCommitteeEip8453,
  getValidatorWeight,
  isConflictingWithFinalityPair,
  isDoubleTargetVote,
  isSlashableAttestationDataEip8453,
  isWellFormedAttestationData,
} from "../../../src/util/eip8453.js";
import {EMPTY_CHECKPOINT, Eip8453Harness, ZERO_ROOT} from "./harness.js";

const N = 70;

describe("eip8453 helpers", () => {
  it("round arithmetic", () => {
    expect(computeRoundAtSlot(0)).toBe(0);
    expect(computeRoundAtSlot(SLOTS_PER_ROUND - 1)).toBe(0);
    expect(computeRoundAtSlot(SLOTS_PER_ROUND)).toBe(1);
    expect(computeStartSlotAtRound(3)).toBe(3 * SLOTS_PER_ROUND);
    const perSlot = ATTESTATION_COMMITTEES_PER_ROUND / SLOTS_PER_ROUND;
    expect(computeAttestationCommitteeSlot(2, 0)).toBe(2 * SLOTS_PER_ROUND);
    expect(computeAttestationCommitteeSlot(2, ATTESTATION_COMMITTEES_PER_ROUND - 1)).toBe(
      2 * SLOTS_PER_ROUND + SLOTS_PER_ROUND - 1
    );
    expect(computeAttestationCommitteeSlot(0, perSlot)).toBe(1);
  });

  it("attestation committees partition the active validators, rotated by epoch", () => {
    const h = new Eip8453Harness(N);
    h.advanceTo(1);
    for (const epoch of [0, 1]) {
      const seen: number[] = [];
      for (let c = 0; c < ATTESTATION_COMMITTEES_PER_ROUND; c++) {
        const committee = getAttestationCommittee(h.state, epoch, c);
        for (const index of committee) {
          expect(getAttestationCommitteeAssignment(h.state, epoch, index)).toBe(c);
          seen.push(index);
        }
      }
      expect(seen.length).toBe(N);
      expect(new Set(seen).size).toBe(N);
    }
    // rotation: committee 0 of epoch 1 starts one validator later than in epoch 0
    expect(getAttestationCommittee(h.state, 1, 0)[0]).toBe(getAttestationCommittee(h.state, 0, 0)[0] + 1);
  });

  it("head vote and inclusion list committees have the preset sizes and only active validators", () => {
    const h = new Eip8453Harness(N);
    h.advanceTo(1);
    const headVoteCommittee = getHeadVoteCommittee(h.state, 5);
    expect(headVoteCommittee.length).toBe(HEAD_VOTE_COMMITTEE_SIZE);
    expect(Array.from(headVoteCommittee).every((i) => i < N)).toBe(true);
    // different slots give different committees
    expect(Array.from(getHeadVoteCommittee(h.state, 6))).not.toEqual(Array.from(headVoteCommittee));
    const ilCommittee = getInclusionListCommitteeEip8453(h.state, 5);
    expect(ilCommittee.length).toBe(INCLUSION_LIST_COMMITTEE_SIZE);
    expect(new Set(ilCommittee).size).toBe(INCLUSION_LIST_COMMITTEE_SIZE);
  });

  it("validator weight scales with effective balance and falls with the square of the inactivity score", () => {
    const full = EJECTION_INACTIVITY_SCORE ** 2;
    expect(getValidatorWeight(32, 0)).toBe(32 * full);
    expect(getValidatorWeight(1, 32768) / full).toBeCloseTo(0.75);
    expect(getValidatorWeight(2048, 0)).toBe(2048 * full);
    expect(getValidatorWeight(32, EJECTION_INACTIVITY_SCORE)).toBe(0);
    expect(getValidatorWeight(32, EJECTION_INACTIVITY_SCORE + 5)).toBe(0);
    expect(getValidatorWeight(0, 0)).toBe(0);
  });

  it("attestation data predicates", () => {
    const a = new Uint8Array(32).fill(0xaa);
    const b = new Uint8Array(32).fill(0xbb);
    expect(
      isWellFormedAttestationData({target: {height: 1, root: a}, timeout: false, finality: EMPTY_CHECKPOINT})
    ).toBe(true);
    expect(
      isWellFormedAttestationData({target: {height: 0, root: a}, timeout: false, finality: EMPTY_CHECKPOINT})
    ).toBe(false);
    expect(
      isWellFormedAttestationData({
        target: {height: 2, root: a},
        timeout: false,
        finality: {height: 1, root: ZERO_ROOT},
      })
    ).toBe(false);
    expect(
      isWellFormedAttestationData({target: {height: 2, root: a}, timeout: false, finality: {height: 2, root: b}})
    ).toBe(false);
    expect(
      isWellFormedAttestationData({target: {height: 2, root: a}, timeout: true, finality: {height: 1, root: b}})
    ).toBe(true);

    const vote = (height: number, root: Uint8Array, timeout = false, finality = EMPTY_CHECKPOINT) => ({
      target: {height, root},
      timeout,
      finality,
    });
    expect(isDoubleTargetVote(vote(3, a), vote(3, b))).toBe(true);
    expect(isDoubleTargetVote(vote(3, a), vote(3, a))).toBe(false);
    expect(isDoubleTargetVote(vote(3, a), vote(3, b, true))).toBe(false);
    expect(isDoubleTargetVote(vote(3, a), vote(4, b))).toBe(false);
    expect(isConflictingWithFinalityPair(vote(3, a, true), {height: 3, root: a})).toBe(true);
    expect(isConflictingWithFinalityPair(vote(3, b), {height: 3, root: a})).toBe(true);
    expect(isConflictingWithFinalityPair(vote(3, a), {height: 3, root: a})).toBe(false);
    expect(isConflictingWithFinalityPair(vote(3, a, true), EMPTY_CHECKPOINT)).toBe(false);
    expect(isSlashableAttestationDataEip8453(vote(4, b, false, {height: 3, root: a}), vote(3, b))).toBe(true);
    expect(isSlashableAttestationDataEip8453(vote(3, a), vote(3, a, true))).toBe(false);
  });
});
