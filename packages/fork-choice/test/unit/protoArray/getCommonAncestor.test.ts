import {expect} from "chai";
import {ProtoArray} from "../../../src";

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
    executionPayloadBlockHash: null,
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
  });

  for (const block of blocks) {
    fc.onBlock({
      slot: block.slot,
      blockRoot: block.root,
      parentRoot: block.parent,
      stateRoot: "-",
      targetRoot: "-",
      executionPayloadBlockHash: null,
      justifiedEpoch: 0,
      justifiedRoot: "-",
      finalizedEpoch: 0,
      finalizedRoot: "-",
    });
  }

  for (const {nodeA, nodeB, ancestor} of testCases) {
    it(`${nodeA} & ${nodeB} -> ${ancestor}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const ancestorNode = fc.getCommonAncestor(fc.getNode(nodeA)!, fc.getNode(nodeB)!);
      expect(ancestorNode && ancestorNode.blockRoot).to.equal(ancestor);
    });
  }
});
