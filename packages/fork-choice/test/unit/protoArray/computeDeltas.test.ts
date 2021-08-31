import {expect} from "chai";

import {computeDeltas} from "../../../src/protoArray/computeDeltas";

describe("computeDeltas", () => {
  it("zero hash", () => {
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = [];
    const newBalances = [];

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set(i.toString(), i);
      votes.push({
        currentRoot: "0",
        nextRoot: "0",
        nextEpoch: 0,
      });
      oldBalances.push(0);
      newBalances.push(0);
    }

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(validatorCount);
    expect(deltas).to.deep.equal(Array.from({length: validatorCount}, () => 0));

    for (const vote of votes) {
      expect(vote.currentRoot).to.eql(vote.nextRoot);
    }
  });

  it("all voted the same", () => {
    const balance = 42;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = [];
    const newBalances = [];

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentRoot: "0",
        nextRoot: "1",
        nextEpoch: 0,
      });
      oldBalances.push(balance);
      newBalances.push(balance);
    }

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(validatorCount);

    for (const [i, delta] of deltas.entries()) {
      if (i === 0) {
        expect(delta.toString()).to.equal((balance * validatorCount).toString());
      } else {
        expect(delta.toString()).to.equal("0");
      }
    }
  });

  it("different votes", () => {
    const balance = 42;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = [];
    const newBalances = [];

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentRoot: "0",
        nextRoot: (i + 1).toString(),
        nextEpoch: 0,
      });
      oldBalances.push(balance);
      newBalances.push(balance);
    }

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(validatorCount);

    for (const delta of deltas) {
      expect(delta.toString()).to.equal(balance.toString());
    }
  });

  it("moving votes", () => {
    const balance = 42;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = [];
    const newBalances = [];

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentRoot: "1",
        nextRoot: "2",
        nextEpoch: 0,
      });
      oldBalances.push(balance);
      newBalances.push(balance);
    }

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(validatorCount);

    const totalDelta = balance * validatorCount;

    for (const [i, delta] of deltas.entries()) {
      if (i === 0) {
        expect(delta.toString()).to.equal((0 - totalDelta).toString());
      } else if (i === 1) {
        expect(delta.toString()).to.equal(totalDelta.toString());
      } else {
        expect(delta.toString()).to.equal("0");
      }
    }
  });

  it("move out of tree", () => {
    const balance = 42;

    const indices = new Map();
    // there is only one block
    indices.set("2", 0);

    // There are two validators
    const votes = [
      // one validator moves their vote from the block to the zero hash
      {
        currentRoot: "2",
        nextRoot: "0",
        nextEpoch: 0,
      },
      // one validator moves their vote from the block to something outside the tree
      {
        currentRoot: "2",
        nextRoot: "1337",
        nextEpoch: 0,
      },
    ];
    const oldBalances = [balance, balance];
    const newBalances = [balance, balance];

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(1);

    expect(deltas[0].toString()).to.eql((0 - balance * 2).toString());

    for (const vote of votes) {
      expect(vote.currentRoot).to.equal(vote.nextRoot);
    }
  });

  it("changing balances", () => {
    const oldBalance = 42;
    const newBalance = 42 * 2;
    const validatorCount = 16;

    const indices = new Map();
    const votes = [];
    const oldBalances = [];
    const newBalances = [];

    for (const i of Array.from({length: validatorCount}, (_, i) => i)) {
      indices.set((i + 1).toString(), i);
      votes.push({
        currentRoot: "1",
        nextRoot: "2",
        nextEpoch: 0,
      });
      oldBalances.push(oldBalance);
      newBalances.push(newBalance);
    }

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(validatorCount);

    for (const [i, delta] of deltas.entries()) {
      if (i === 0) {
        expect(delta.toString()).to.equal((0 - oldBalance * validatorCount).toString());
      } else if (i === 1) {
        expect(delta.toString()).to.equal((newBalance * validatorCount).toString());
      } else {
        expect(delta.toString()).to.equal("0");
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
      currentRoot: "2",
      nextRoot: "3",
      nextEpoch: 0,
    }));
    // There is only one validator in the old balances.
    const oldBalances = [balance];
    // There are two validators in the new balances.
    const newBalances = [balance, balance];

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(2);

    expect(deltas[0].toString()).to.eql((0 - balance).toString());
    expect(deltas[1].toString()).to.eql((balance * 2).toString());

    for (const vote of votes) {
      expect(vote.currentRoot).to.equal(vote.nextRoot);
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
      currentRoot: "2",
      nextRoot: "3",
      nextEpoch: 0,
    }));
    // There are two validators in the old balances.
    const oldBalances = [balance, balance];
    // There is only one validator in the new balances.
    const newBalances = [balance];

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(2);

    expect(deltas[0].toString()).to.eql((0 - balance * 2).toString());
    expect(deltas[1].toString()).to.eql(balance.toString());

    for (const vote of votes) {
      expect(vote.currentRoot).to.equal(vote.nextRoot);
    }
  });
});
