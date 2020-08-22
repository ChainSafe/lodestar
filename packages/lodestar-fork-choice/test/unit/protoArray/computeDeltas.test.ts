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
      oldBalances.push(BigInt(0));
      newBalances.push(BigInt(0));
    }

    const deltas = computeDeltas(indices, votes, oldBalances, newBalances);

    expect(deltas.length).to.eql(validatorCount);
    expect(deltas).to.deep.equal(Array.from({length: validatorCount}, () => BigInt(0)));

    for (const vote of votes) {
      expect(vote.currentRoot).to.eql(vote.nextRoot);
    }
  });

  it("all voted the same", () => {
    const balance = BigInt(42);
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
        expect(delta.toString()).to.equal((balance * BigInt(validatorCount)).toString());
      } else {
        expect(delta.toString()).to.equal(BigInt(0).toString());
      }
    }
  });

  it("different votes", () => {
    const balance = BigInt(42);
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
});
