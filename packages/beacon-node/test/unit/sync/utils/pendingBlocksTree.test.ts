import {describe, it, expect} from "vitest";
import {RootHex} from "@lodestar/types";
import {PendingBlock, PendingBlockStatus, UnknownAndAncestorBlocks} from "../../../../src/sync/index.js";
import {
  getAllDescendantBlocks,
  getDescendantBlocks,
  getUnknownAndAncestorBlocks,
} from "../../../../src/sync/utils/pendingBlocksTree.js";

describe("sync / pendingBlocksTree", () => {
  const testCases: {
    id: string;
    blocks: {block: string; parent: string | null}[];
    getAllDescendantBlocks: {block: string; res: string[]}[];
    getDescendantBlocks: {block: string; res: string[]}[];
    getUnknownOrAncestorBlocks: {unknowns: string[]; ancestors: string[]};
  }[] = [
    {
      id: "empty case",
      blocks: [],
      getAllDescendantBlocks: [{block: "0A", res: []}],
      getDescendantBlocks: [{block: "0A", res: []}],
      getUnknownOrAncestorBlocks: {unknowns: [], ancestors: []},
    },
    {
      id: "two branches with multiple blocks",
      blocks: [
        {block: "0A", parent: null},
        {block: "1A", parent: "0A"},
        {block: "2A", parent: "1A"},
        {block: "3A", parent: "2A"},
        {block: "2B", parent: "1A"},
        {block: "3B", parent: "2B"},
        {block: "4C", parent: "3C"},
      ],
      getAllDescendantBlocks: [
        {block: "0A", res: ["1A", "2A", "3A", "2B", "3B"]},
        {block: "3C", res: ["4C"]},
        {block: "3B", res: []},
      ],
      getDescendantBlocks: [
        {block: "0A", res: ["1A"]},
        {block: "1A", res: ["2A", "2B"]},
        {block: "3C", res: ["4C"]},
        {block: "3B", res: []},
      ],
      getUnknownOrAncestorBlocks: {unknowns: ["0A"], ancestors: ["4C"]},
    },
  ];

  for (const testCase of testCases) {
    const blocks = new Map<RootHex, PendingBlock>();
    for (const block of testCase.blocks) {
      blocks.set(block.block, {
        blockRootHex: block.block,
        parentBlockRootHex: block.parent,
        status: block.parent == null ? PendingBlockStatus.pending : PendingBlockStatus.downloaded,
      } as PendingBlock);
    }

    describe(testCase.id, () => {
      for (const {block, res} of testCase.getAllDescendantBlocks) {
        it(`getAllDescendantBlocks(${block})`, () => {
          expect(toRes(getAllDescendantBlocks(block, blocks))).toEqual(res);
        });
      }

      for (const {block, res} of testCase.getDescendantBlocks) {
        it(`getDescendantBlocks(${block})`, () => {
          expect(toRes(getDescendantBlocks(block, blocks))).toEqual(res);
        });
      }

      it("getUnknownBlocks", () => {
        expect(toRes2(getUnknownAndAncestorBlocks(blocks))).toEqual(testCase.getUnknownOrAncestorBlocks);
      });
    });
  }
});

function toRes(blocks: PendingBlock[]): string[] {
  return blocks.map((block) => block.blockRootHex);
}

function toRes2(blocks: UnknownAndAncestorBlocks): {unknowns: string[]; ancestors: string[]} {
  return {
    unknowns: blocks.unknowns.map((block) => block.blockRootHex),
    ancestors: blocks.ancestors.map((block) => block.blockRootHex),
  };
}
