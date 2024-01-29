import {describe, it, expect} from "vitest";
import {getEffectiveBalanceIncrementsZeroed} from "@lodestar/state-transition";

import {computeDeltas} from "../../../src/protoArray/computeDeltas.js";

describe("computeDeltas", () => {
  it("zero hash", () => {
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);
    const newBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set(i.toString(), i);
      votes.push({
        currentIndex: 0,
        nextIndex: 0,
        nextEpoch: 0,
      });
      oldBalances[i] = 0;
      newBalances[i] = 0;
    }

    const deltas = computeDeltas(indices.size, votes, oldBalances, newBalances, new Set());

    expect(deltas.length).toEqual(validatorCount);
    expect(deltas).toEqual(Array.from({length: validatorCount}, () => 0));

    for (const vote of votes) {
      expect(vote.currentIndex).toEqual(vote.nextIndex);
    }
  });

  it("all voted the same", () => {
    const balance = 42;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);
    const newBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentIndex: null,
        nextIndex: 0,
        nextEpoch: 0,
      });
      oldBalances[i] = balance;
      newBalances[i] = balance;
    }

    const deltas = computeDeltas(indices.size, votes, oldBalances, newBalances, new Set());

    expect(deltas.length).toEqual(validatorCount);

    for (const [i, delta] of deltas.entries()) {
      if (i === 0) {
        expect(delta.toString()).toBe((balance * validatorCount).toString());
      } else {
        expect(delta.toString()).toBe("0");
      }
    }
  });

  it("different votes", () => {
    const balance = 42;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);
    const newBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentIndex: null,
        nextIndex: i,
        nextEpoch: 0,
      });
      oldBalances[i] = balance;
      newBalances[i] = balance;
    }

    const deltas = computeDeltas(indices.size, votes, oldBalances, newBalances, new Set());

    expect(deltas.length).toEqual(validatorCount);

    for (const delta of deltas) {
      expect(delta.toString()).toBe(balance.toString());
    }
  });

  it("moving votes", () => {
    const balance = 42;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);
    const newBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentIndex: 0,
        nextIndex: 1,
        nextEpoch: 0,
      });
      oldBalances[i] = balance;
      newBalances[i] = balance;
    }

    const deltas = computeDeltas(indices.size, votes, oldBalances, newBalances, new Set());

    expect(deltas.length).toEqual(validatorCount);

    const totalDelta = balance * validatorCount;

    for (const [i, delta] of deltas.entries()) {
      if (i === 0) {
        expect(delta.toString()).toBe((0 - totalDelta).toString());
      } else if (i === 1) {
        expect(delta.toString()).toBe(totalDelta.toString());
      } else {
        expect(delta.toString()).toBe("0");
      }
    }
  });

  it("changing balances", () => {
    const oldBalance = 42;
    const newBalance = 42 * 2;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);
    const newBalances = getEffectiveBalanceIncrementsZeroed(validatorCount);

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentIndex: 0,
        nextIndex: 1,
        nextEpoch: 0,
      });
      oldBalances[i] = oldBalance;
      newBalances[i] = newBalance;
    }

    const deltas = computeDeltas(indices.size, votes, oldBalances, newBalances, new Set());

    expect(deltas.length).toEqual(validatorCount);

    for (const [i, delta] of deltas.entries()) {
      if (i === 0) {
        expect(delta.toString()).toBe((0 - oldBalance * validatorCount).toString());
      } else if (i === 1) {
        expect(delta.toString()).toBe((newBalance * validatorCount).toString());
      } else {
        expect(delta.toString()).toBe("0");
      }
    }
  });

  it("validator appears", () => {
    const balance = 42;

    const indices = new Map();
    // there are two block
    indices.set("2", 0);
    indices.set("3", 1);

    // Both validators move votes from block1 to block2
    const votes = Array.from({length: 2}, () => ({
      currentIndex: 0,
      nextIndex: 1,
      nextEpoch: 0,
    }));

    // There is only one validator in the old balances.
    const oldBalances = getEffectiveBalanceIncrementsZeroed(1);
    oldBalances[0] = balance;
    // There are two validators in the new balances.
    const newBalances = getEffectiveBalanceIncrementsZeroed(2);
    newBalances[0] = balance;
    newBalances[1] = balance;

    const deltas = computeDeltas(indices.size, votes, oldBalances, newBalances, new Set());

    expect(deltas.length).toEqual(2);

    expect(deltas[0].toString()).toEqual((0 - balance).toString());
    expect(deltas[1].toString()).toEqual((balance * 2).toString());

    for (const vote of votes) {
      expect(vote.currentIndex).toBe(vote.nextIndex);
    }
  });

  it("validator disappears", () => {
    const balance = 42;

    const indices = new Map();
    // there are two block
    indices.set("2", 0);
    indices.set("3", 1);

    // Both validators move votes from block1 to block2
    const votes = Array.from({length: 2}, () => ({
      currentIndex: 0,
      nextIndex: 1,
      nextEpoch: 0,
    }));
    // There are two validators in the old balances.
    const oldBalances = getEffectiveBalanceIncrementsZeroed(2);
    oldBalances[0] = balance;
    oldBalances[1] = balance;
    // There is only one validator in the new balances.
    const newBalances = getEffectiveBalanceIncrementsZeroed(1);
    newBalances[0] = balance;

    const deltas = computeDeltas(indices.size, votes, oldBalances, newBalances, new Set());

    expect(deltas.length).toEqual(2);

    expect(deltas[0].toString()).toEqual((0 - balance * 2).toString());
    expect(deltas[1].toString()).toEqual(balance.toString());

    for (const vote of votes) {
      expect(vote.currentIndex).toBe(vote.nextIndex);
    }
  });

  it("not empty equivocation set", () => {
    const firstBalance = 31;
    const secondBalance = 32;

    const indices = new Map();
    // there are two block
    indices.set("2", 0);
    indices.set("3", 1);

    // Both validators move votes from block1 to block2
    const votes = Array.from({length: 2}, () => ({
      currentIndex: 0,
      nextIndex: 1,
      nextEpoch: 0,
    }));

    const balances = new Uint8Array([firstBalance, secondBalance]);
    // 1st validator is part of an attester slashing
    const equivocatingIndices = new Set([0]);
    let deltas = computeDeltas(indices.size, votes, balances, balances, equivocatingIndices);
    expect(deltas[0]).toBeWithMessage(
      -1 * (firstBalance + secondBalance),
      "should disregard the 1st validator due to attester slashing"
    );
    expect(deltas[1]).toBeWithMessage(secondBalance, "should move 2nd balance from 1st root to 2nd root");
    deltas = computeDeltas(indices.size, votes, balances, balances, equivocatingIndices);
    expect(deltas).toEqualWithMessage([0, 0], "calling computeDeltas again should not have any affect on the weight");
  });
});
