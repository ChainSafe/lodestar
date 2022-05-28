import {expect} from "chai";
import {ProtoArray, ExecutionStatus} from "../../../src/index.js";

describe("getCommonAncestor", () => {
  const blocks: {slot: number; root: string; parent: string}[] = [
    {slot: 1, root: "1A", parent: "0"},
    {slot: 2, root: "2A", parent: "1A"},
    {slot: 3, root: "3A", parent: "2A"},
    {slot: 2, root: "2B", parent: "1A"},
    {slot: 2, root: "3B", parent: "2B"},
    {slot: 2, root: "2C", parent: "none"},
    {slot: 3, root: "3C", parent: "2C"},
  ];

  const testCases: {nodeA: string; nodeB: string; ancestor: string | null}[] = [
    {nodeA: "3A", nodeB: "3B", ancestor: "1A"},
    {nodeA: "3A", nodeB: "2B", ancestor: "1A"},
    {nodeA: "2A", nodeB: "3B", ancestor: "1A"},
    {nodeA: "1A", nodeB: "3B", ancestor: "1A"},
    {nodeA: "3A", nodeB: "1A", ancestor: "1A"},
    {nodeA: "1A", nodeB: "1A", ancestor: "1A"},
    {nodeA: "3A", nodeB: "3C", ancestor: null},
    {nodeA: "3B", nodeB: "3C", ancestor: null},
    {nodeA: "1A", nodeB: "3C", ancestor: null},
  ];

  const fc = ProtoArray.initialize({
    slot: 0,
    stateRoot: "-",
    parentRoot: "-",
    blockRoot: "0",

    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
  });

  for (const block of blocks) {
    fc.onBlock({
      slot: block.slot,
      blockRoot: block.root,
      parentRoot: block.parent,
      stateRoot: "-",
      targetRoot: "-",

      justifiedEpoch: 0,
      justifiedRoot: "-",
      finalizedEpoch: 0,
      finalizedRoot: "-",

      ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
    });
  }

  for (const {nodeA, nodeB, ancestor} of testCases) {
    it(`${nodeA} & ${nodeB} -> ${ancestor}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const ancestorNode = fc.getCommonAncestor(fc.getNode(nodeA)!, fc.getNode(nodeB)!);
      expect(ancestorNode && ancestorNode.blockRoot).to.equal(ancestor);
    });
  }

  const deltas = Array.from({length: fc.nodes.length}, () => 0);
  fc.applyScoreChanges({
    deltas,
    proposerBoost: {root: blocks[blocks.length - 1].root, score: 34},
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
  });
  const weightsAfterCall1 = fc.nodes.map((nrow) => nrow.weight);

  const deltasNew = Array.from({length: fc.nodes.length}, () => 0);
  fc.applyScoreChanges({
    deltas: deltasNew,
    proposerBoost: {root: blocks[blocks.length - 1].root, score: 34},
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
  });
  const weightsAfterCall2 = fc.nodes.map((nrow) => nrow.weight);

  // multiple calls to applyScoreChanges don't keep on adding boosts to weight over
  // and over again, and applyScoreChanges can be safely called after onAttestations
  expect(weightsAfterCall1).to.deep.equal(weightsAfterCall2);
});
