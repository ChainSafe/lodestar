import {describe, expect, it} from "vitest";
import {
  emptyFinalitySigningRecord,
  getFinalityAttestationData,
  recordFinalityAttestation,
} from "../../../src/services/decoupledConsensus.js";

const root = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);
const cp = (height: number, byte: number) => ({height, root: root(byte)});
const EMPTY = {height: 0, root: root(0)};

describe("FinalitySigningRecord (validator.md get_finality_attestation_data)", () => {
  it("votes the target with the justified pair as finality on a fresh record", () => {
    const record = emptyFinalitySigningRecord();
    const data = getFinalityAttestationData(record, cp(5, 0xaa), cp(4, 0xbb), 3);
    expect(data).toEqual({target: cp(5, 0xaa), timeout: false, finality: cp(4, 0xbb)});
  });

  it("drops the finality pair when the justified height is already finalized", () => {
    const record = emptyFinalitySigningRecord();
    const data = getFinalityAttestationData(record, cp(5, 0xaa), cp(4, 0xbb), 4);
    expect(data?.finality).toEqual(EMPTY);
  });

  it("suppresses a second vote for the same target and times out a conflicting target", () => {
    const record = emptyFinalitySigningRecord();
    const first = getFinalityAttestationData(record, cp(5, 0xaa), cp(4, 0xbb), 3);
    recordFinalityAttestation(record, first as NonNullable<typeof first>);
    // same height, same root: already entered
    expect(getFinalityAttestationData(record, cp(5, 0xaa), cp(4, 0xbb), 3)).toBeNull();
    // same height, other root: a timeout, since the first target is recorded and no lock applies
    const conflicting = getFinalityAttestationData(record, cp(5, 0xcc), cp(4, 0xbb), 3);
    expect(conflicting?.timeout).toBe(true);
    expect(conflicting?.target).toEqual(cp(5, 0xcc));
    recordFinalityAttestation(record, conflicting as NonNullable<typeof conflicting>);
    // once a timeout is signed at the height, every later vote there is a timeout
    expect(record.timeouts.has(5)).toBe(true);
  });

  it("never votes a target that conflicts with a finality lock at the same height", () => {
    const record = emptyFinalitySigningRecord();
    const first = getFinalityAttestationData(record, cp(6, 0xaa), cp(5, 0xbb), 3);
    recordFinalityAttestation(record, first as NonNullable<typeof first>);
    expect(record.finalityLocks.get(5)).toBe(`0x${"bb".repeat(32)}`);
    // the chain now targets height 5 with another root: locked, no vote
    expect(getFinalityAttestationData(record, cp(5, 0xcc), cp(4, 0xdd), 3)).toBeNull();
    // the locked root itself is still a valid target
    const locked = getFinalityAttestationData(record, cp(5, 0xbb), cp(4, 0xdd), 3);
    expect(locked?.target).toEqual(cp(5, 0xbb));
    expect(locked?.timeout).toBe(false);
  });

  it("returns null for the empty target and clears a finality pair at or above the target height", () => {
    const record = emptyFinalitySigningRecord();
    expect(getFinalityAttestationData(record, EMPTY, cp(4, 0xbb), 3)).toBeNull();
    // a justified root differing from the target at the same height locks the vote away: no attestation
    expect(getFinalityAttestationData(record, cp(4, 0xaa), cp(4, 0xbb), 3)).toBeNull();
    // the same root at the target height is voted, with the finality pair cleared
    const data = getFinalityAttestationData(record, cp(4, 0xaa), cp(4, 0xaa), 3);
    expect(data?.target).toEqual(cp(4, 0xaa));
    expect(data?.finality).toEqual(EMPTY);
  });
});
