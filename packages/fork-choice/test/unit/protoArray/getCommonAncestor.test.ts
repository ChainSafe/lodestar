import {describe, it, expect} from "vitest";
import {ProtoArray, ExecutionStatus, DataAvailabilityStatus} from "../../../src/index.js";

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

  const fc = ProtoArray.initialize(
    {
      slot: 0,
      stateRoot: "-",
      parentRoot: "-",
      blockRoot: "0",

      justifiedEpoch: 0,
      justifiedRoot: "-",
      finalizedEpoch: 0,
      finalizedRoot: "-",
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: "-",
      unrealizedFinalizedEpoch: 0,
      unrealizedFinalizedRoot: "-",

      timeliness: false,

      ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    },
    0
  );

  for (const block of blocks) {
    fc.onBlock(
      {
        slot: block.slot,
        blockRoot: block.root,
        parentRoot: block.parent,
        stateRoot: "-",
        targetRoot: "-",

        justifiedEpoch: 0,
        justifiedRoot: "-",
        finalizedEpoch: 0,
        finalizedRoot: "-",
        unrealizedJustifiedEpoch: 0,
        unrealizedJustifiedRoot: "-",
        unrealizedFinalizedEpoch: 0,
        unrealizedFinalizedRoot: "-",

        timeliness: false,

        ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      },
      block.slot
    );
  }

  for (const {nodeA, nodeB, ancestor} of testCases) {
    it(`${nodeA} & ${nodeB} -> ${ancestor}`, () => {
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      const ancestorNode = fc.getCommonAncestor(fc.getNode(nodeA)!, fc.getNode(nodeB)!);
      expect(ancestorNode && ancestorNode.blockRoot).toBe(ancestor);
    });
  }

  const lastSlot = blocks.reverse()[0].slot;
  const deltas = Array.from({length: fc.nodes.length}, () => 0);
  fc.applyScoreChanges({
    deltas,
    proposerBoost: {root: blocks[blocks.length - 1].root, score: 34},
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
    currentSlot: lastSlot,
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
    currentSlot: lastSlot,
  });
  const weightsAfterCall2 = fc.nodes.map((nrow) => nrow.weight);

  // multiple calls to applyScoreChanges don't keep on adding boosts to weight over
  // and over again, and applyScoreChanges can be safely called after onAttestations
  expect(weightsAfterCall1).toEqual(weightsAfterCall2);
});
