import {describe, expect, it} from "vitest";
import {ForkPostElectra} from "@lodestar/params";
import {SingleAttestation, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {IncludedAttesters, SingleAttestationPool} from "../../../../src/chain/opPools/singleAttestationPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {ProposerTracker} from "../../../../src/chain/proposerTracker.js";

describe("chain / opPools / SingleAttestationPool", () => {
  const slot = 999;
  const committeeIndex = 3;
  const committeeSize = 8;
  const data = ssz.phase0.AttestationData.defaultValue();
  data.slot = slot;
  const attDataRootHex = toHex(ssz.phase0.AttestationData.hashTreeRoot(data));
  // attester validator index = 100 + position in committee
  const effectiveBalanceIncrements = new Uint16Array(200).fill(32);

  function getSingle(validatorCommitteeIndex: number): SingleAttestation<ForkPostElectra> {
    return {committeeIndex, attesterIndex: 100 + validatorCommitteeIndex, data, signature: new Uint8Array(96)};
  }

  function addSingles(pool: SingleAttestationPool, validatorCommitteeIndices: number[]): void {
    for (const validatorCommitteeIndex of validatorCommitteeIndices) {
      pool.add(getSingle(validatorCommitteeIndex), attDataRootHex, validatorCommitteeIndex, committeeSize);
    }
  }

  function getUncoveredPositions(pool: SingleAttestationPool, notSeen: number[]): number[] | null {
    const uncovered = pool.getUncovered(
      slot,
      attDataRootHex,
      committeeIndex,
      new Set(notSeen),
      effectiveBalanceIncrements,
      committeeSize
    );
    return uncovered === null ? null : uncovered.singles.map((s) => s.validatorCommitteeIndex).sort((a, b) => a - b);
  }

  it("adds once per committee member", () => {
    const pool = new SingleAttestationPool();
    expect(pool.add(getSingle(1), attDataRootHex, 1, committeeSize)).toBe(InsertOutcome.NewData);
    expect(pool.add(getSingle(1), attDataRootHex, 1, committeeSize)).toBe(InsertOutcome.AlreadyKnown);

    expect(pool.getStoredSlots()).toEqual([slot]);
    expect(Array.from(pool.getDataRoots(slot).keys())).toEqual([attDataRootHex]);
    expect(pool.getCommitteeIndices(slot, attDataRootHex)).toEqual([committeeIndex]);
  });

  it("returns only single attestations of not seen committee members", () => {
    const pool = new SingleAttestationPool();
    addSingles(pool, [1, 2, 5]);

    const uncovered = pool.getUncovered(
      slot,
      attDataRootHex,
      committeeIndex,
      new Set([2, 5, 6]),
      effectiveBalanceIncrements,
      committeeSize
    );
    expect(uncovered?.singles.map((s) => s.validatorCommitteeIndex).sort()).toEqual([2, 5]);
    expect(uncovered?.committeeSize).toBe(committeeSize);
    expect(uncovered?.newSeenAttesters).toBe(2);
    expect(uncovered?.newSeenEffectiveBalance).toBe(64);

    expect(getUncoveredPositions(pool, [0, 6])).toBeNull();
    // more not seen members than singles
    expect(getUncoveredPositions(pool, [1, 2, 3, 4, 5, 6])).toEqual([1, 2, 5]);
  });

  it("bounds uncovered singles to the highest effective balances without removing the rest", () => {
    const pool = new SingleAttestationPool();
    addSingles(pool, [0, 1, 2, 5]);
    const notSeen = new Set([1, 2, 5]);
    const balances = effectiveBalanceIncrements.slice();
    balances[105] = 64;

    const uncovered = pool.getUncovered(slot, attDataRootHex, committeeIndex, notSeen, balances, 2);
    expect(uncovered?.singles.map((s) => s.validatorCommitteeIndex)).toEqual([5, 1]);
    expect(uncovered?.newSeenAttesters).toBe(2);
    expect(uncovered?.newSeenEffectiveBalance).toBe(96);
    expect(pool.getUncovered(slot, attDataRootHex, committeeIndex, notSeen, balances, 0)).toBeNull();
    expect(getUncoveredPositions(pool, [1, 2, 5])).toEqual([1, 2, 5]);
    expect(Array.from(notSeen)).toEqual([1, 2, 5]);
  });

  it("deletes single attestations included by the parent of the new head", () => {
    const pool = new SingleAttestationPool();
    addSingles(pool, [1, 2, 5]);
    // validator index = 100 + position in committee, not sorted like in block import
    const included: IncludedAttesters[] = [{slot, attDataRootHex, attestingIndices: [105, 99, 101]}];

    // the head itself is kept, a proposer boost reorg may orphan it
    expect(pool.onHead("0xb1", "0xb0", included)).toBe(0);
    expect(getUncoveredPositions(pool, [1, 2, 5])).toEqual([1, 2, 5]);

    expect(pool.onHead("0xb2", "0xb1", [])).toBe(2);
    expect(getUncoveredPositions(pool, [1, 2, 5])).toEqual([2]);

    // two attestations of the same data, validator 101 already deleted, last single empties the pool
    const included2: IncludedAttesters[] = [
      {slot, attDataRootHex, attestingIndices: [101, 103]},
      {slot, attDataRootHex, attestingIndices: [102, 101]},
    ];
    pool.onHead("0xb3", "0xb2", included2);
    expect(pool.onHead("0xb4", "0xb3", [])).toBe(1);
    expect(pool.getStoredSlots()).toEqual([]);
    expect(pool.add(getSingle(2), attDataRootHex, 2, committeeSize)).toBe(InsertOutcome.NewData);
  });

  it("does not delete single attestations of a reorged head", () => {
    const pool = new SingleAttestationPool();
    addSingles(pool, [1, 2, 5]);
    const included: IncludedAttesters[] = [{slot, attDataRootHex, attestingIndices: [105, 101]}];

    expect(pool.onHead("0xb1", "0xb0", included)).toBe(0);
    // new head builds on 0xb0, not on 0xb1
    expect(pool.onHead("0xb1b", "0xb0", [{slot, attDataRootHex, attestingIndices: [102]}])).toBe(0);
    expect(getUncoveredPositions(pool, [1, 2, 5])).toEqual([1, 2, 5]);

    // fewer attesters than singles
    expect(pool.onHead("0xb2", "0xb1b", [])).toBe(1);
    expect(getUncoveredPositions(pool, [1, 2, 5])).toEqual([1, 5]);
  });

  it("prunes vote slots that no upcoming proposal can include", () => {
    const pool = new SingleAttestationPool();
    addSingles(pool, [1]);

    const proposerTracker = new ProposerTracker(8);
    proposerTracker.addProposal(slot + 1);
    pool.prune(proposerTracker);
    expect(pool.getStoredSlots()).toEqual([slot]);

    pool.onHead("0xb1", "0xb0", [{slot, attDataRootHex, attestingIndices: [101]}]);
    proposerTracker.prune(slot + 2);
    pool.prune(proposerTracker);
    expect(pool.getStoredSlots()).toEqual([]);
    // size is consistent again, so the same member can be added
    expect(pool.add(getSingle(1), attDataRootHex, 1, committeeSize)).toBe(InsertOutcome.NewData);
    // pending head was dropped with the window
    expect(pool.onHead("0xb2", "0xb1", [])).toBe(0);
    expect(getUncoveredPositions(pool, [1])).toEqual([1]);
  });
});
