import {describe, expect, it} from "vitest";
import {EMPTY_HEIGHT} from "@lodestar/params";
import {decoupled} from "@lodestar/types";
import {DcHarness, ZERO_ROOT, range} from "./harness.js";

const N = 64;
const rootA = new Uint8Array(32).fill(0xaa);
const rootB = new Uint8Array(32).fill(0xbb);
const emptyPair = {height: EMPTY_HEIGHT, root: ZERO_ROOT};

describe("decoupled attester slashings 2 (scripted votes)", () => {
  function slashing(
    h: DcHarness,
    voters1: number[],
    data1: decoupled.AttestationData2,
    voters2: number[],
    data2: decoupled.AttestationData2
  ): decoupled.AttesterSlashing2 {
    return {
      attestation1: h.indexedAttestation(1, voters1, data1),
      attestation2: h.indexedAttestation(1, voters2, data2),
    };
  }

  it("E2: two non-empty targets at the same height slash the intersection", () => {
    const h = new DcHarness(N);
    const s = slashing(
      h,
      range(0, 8),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootA}},
      range(4, 12),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootB}}
    );
    h.produceBlock(1, {attesterSlashings2: [s]});
    const slashed = h.state.validators.getAllReadonlyValues().map((v) => v.slashed);
    expect(slashed.slice(0, 4).every((x) => !x)).toBe(true);
    expect(slashed.slice(4, 8).every((x) => x)).toBe(true);
    expect(slashed.slice(8).every((x) => !x)).toBe(true);
  });

  it("E1: a finality vote conflicting with a target vote at the same height is slashable, including an empty target", () => {
    const h = new DcHarness(N);
    const s = slashing(
      h,
      range(0, 4),
      {round: 0, finalizePair: {height: 1, root: rootA}, targetPair: {height: 2, root: rootB}},
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: ZERO_ROOT}}
    );
    h.produceBlock(1, {attesterSlashings2: [s]});
    const slashed = h.state.validators.getAllReadonlyValues().map((v) => v.slashed);
    expect(slashed.slice(0, 4).every((x) => x)).toBe(true);
    expect(slashed.slice(4).every((x) => !x)).toBe(true);
  });

  it("the same pairs in a different order are still slashable", () => {
    const h = new DcHarness(N);
    const s = slashing(
      h,
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootB}},
      range(0, 4),
      {round: 0, finalizePair: {height: 1, root: rootA}, targetPair: {height: 2, root: rootB}}
    );
    h.produceBlock(1, {attesterSlashings2: [s]});
    expect(h.state.validators.getReadonly(0).slashed).toBe(true);
  });

  it("empty targets at the same height are not slashable", () => {
    const h = new DcHarness(N);
    const s = slashing(
      h,
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: ZERO_ROOT}},
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootA}}
    );
    expect(() => h.produceBlock(1, {attesterSlashings2: [s]})).toThrow(/not slashable/);
  });

  it("targets at different heights are not slashable", () => {
    const h = new DcHarness(N);
    const s = slashing(
      h,
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootA}},
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 2, root: rootB}}
    );
    expect(() => h.produceBlock(1, {attesterSlashings2: [s]})).toThrow(/not slashable/);
  });

  it("a slashing with no intersecting validators is rejected", () => {
    const h = new DcHarness(N);
    const s = slashing(
      h,
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootA}},
      range(4, 8),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootB}}
    );
    expect(() => h.produceBlock(1, {attesterSlashings2: [s]})).toThrow(/did not result in any slashings/);
  });

  it("a slashing with a bad signature is rejected", () => {
    const h = new DcHarness(N);
    const s = slashing(
      h,
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootA}},
      range(0, 4),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootB}}
    );
    s.attestation2.signature = s.attestation1.signature;
    expect(() => h.produceBlock(1, {attesterSlashings2: [s]})).toThrow(/attestation2 is invalid/);
  });

  it("slashed validators no longer count towards quorums", () => {
    const h = new DcHarness(N);
    // validator 0 proposes, so slash 1..22
    const s = slashing(
      h,
      range(1, 23),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootA}},
      range(1, 23),
      {round: 0, finalizePair: emptyPair, targetPair: {height: 1, root: rootB}}
    );
    h.produceBlock(1, {attesterSlashings2: [s]});
    // 42 unslashed of 64 total active (slashed validators stay active until their exit epoch) is below 2/3
    const unslashed = [0, ...range(23, 64)];
    const snap = h.produceBlock(2, {attestations: [h.vote(2, {voters: unslashed, target: "current"})]});
    expect(snap.target.height).toBe(1);
    // a vote including the slashed validators still does not reach quorum
    const snap2 = h.produceBlock(3, {attestations: [h.vote(3, {voters: range(0, 64), target: "current"})]});
    expect(snap2.target.height).toBe(1);
  });
});
