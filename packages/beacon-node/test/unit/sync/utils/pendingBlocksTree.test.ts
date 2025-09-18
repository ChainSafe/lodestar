import {RootHex} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  getBlockInputSyncCacheItemRootHex,
} from "../../../../src/sync/types.js";
import {
  UnknownAndAncestorBlocks,
  getAllDescendantBlocks,
  getDescendantBlocks,
  getUnknownAndAncestorBlocks,
} from "../../../../src/sync/utils/pendingBlocksTree.js";
import {MockBlockInput} from "../../../utils/blockInput.js";

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
    const blocks = new Map<RootHex, BlockInputSyncCacheItem>();
    for (const block of testCase.blocks) {
      const pending: PendingBlockInput = {
        status: block.parent === null ? PendingBlockInputStatus.pending : PendingBlockInputStatus.downloaded,
        blockInput: new MockBlockInput({blockRootHex: block.block, parentRootHex: block.parent}),
        peerIdStrings: new Set(),
        timeAddedSec: 0,
      };
      blocks.set(pending.blockInput.blockRootHex, pending);
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

function toRes(blocks: BlockInputSyncCacheItem[]): string[] {
  return blocks.map((block) => getBlockInputSyncCacheItemRootHex(block));
}

function toRes2(blocks: UnknownAndAncestorBlocks): {unknowns: string[]; ancestors: string[]} {
  return {
    unknowns: blocks.unknowns.map((block) => getBlockInputSyncCacheItemRootHex(block)),
    ancestors: blocks.ancestors.map((block) => getBlockInputSyncCacheItemRootHex(block)),
  };
}
