import {RootHex} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {PendingBlock, PendingBlockStatus} from "../../../../src/sync";
import {
  getAllDescendantBlocks,
  getDescendantBlocks,
  getLowestPendingUnknownParents,
} from "../../../../src/sync/utils/pendingBlocksTree";

describe("sync / pendingBlocksTree", () => {
  const testCases: {
    id: string;
    blocks: {block: string; parent: string}[];
    getAllDescendantBlocks: {block: string; res: string[]}[];
    getDescendantBlocks: {block: string; res: string[]}[];
    getLowestPendingUnknownParents: string[];
  }[] = [
    {
      id: "empty case",
      blocks: [],
      getAllDescendantBlocks: [{block: "0A", res: []}],
      getDescendantBlocks: [{block: "0A", res: []}],
      getLowestPendingUnknownParents: [],
    },
    {
      id: "two branches with multiple blocks",
      blocks: [
        {block: "0A", parent: "-"},
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
      getLowestPendingUnknownParents: ["0A", "4C"],
    },
  ];

  for (const testCase of testCases) {
    const blocks = new Map<RootHex, PendingBlock>();
    for (const block of testCase.blocks) {
      blocks.set(block.block, {
        blockRootHex: block.block,
        parentBlockRootHex: block.parent,
        status: PendingBlockStatus.pending,
      } as PendingBlock);
    }

    describe(testCase.id, () => {
      for (const {block, res} of testCase.getAllDescendantBlocks) {
        it(`getAllDescendantBlocks(${block})`, () => {
          expect(toRes(getAllDescendantBlocks(block, blocks))).to.deep.equal(res);
        });
      }

      for (const {block, res} of testCase.getDescendantBlocks) {
        it(`getDescendantBlocks(${block})`, () => {
          expect(toRes(getDescendantBlocks(block, blocks))).to.deep.equal(res);
        });
      }

      it("getLowestPendingUnknownParents", () => {
        expect(toRes(getLowestPendingUnknownParents(blocks))).to.deep.equal(testCase.getLowestPendingUnknownParents);
      });
    });
  }
});

function toRes(blocks: PendingBlock[]): string[] {
  return blocks.map((block) => block.blockRootHex);
}
