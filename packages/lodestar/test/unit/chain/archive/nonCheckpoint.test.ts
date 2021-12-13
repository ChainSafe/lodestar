import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Slot} from "@chainsafe/lodestar-types";
import {getNonCheckpointBlocks} from "../../../../src/chain/archiver/archiveBlocks";

describe("chain / archive / getNonCheckpointBlocks", () => {
  before("Correct params", () => {
    expect(SLOTS_PER_EPOCH).to.equal(8, "Wrong SLOTS_PER_EPOCH");
  });

  const testCases: {id: string; blocks: Slot[]; maybeCheckpointBlocks: Slot[]}[] = [
    {id: "empty", blocks: [], maybeCheckpointBlocks: []},
    {id: "one block", blocks: [4], maybeCheckpointBlocks: [4]},
    {id: "one block in first slot", blocks: [0], maybeCheckpointBlocks: [0]},
    {id: "one block per epoch", blocks: [4, 12, 20], maybeCheckpointBlocks: [4, 12, 20]},
    {id: "two blocks per epoch", blocks: [4, 5, 12, 13, 20, 21], maybeCheckpointBlocks: [5, 13, 21]},
    {
      id: "linear sequence of blocks",
      blocks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      maybeCheckpointBlocks: [0, 8, 16, 17],
    },
    {
      id: "linear sequence of blocks, first block skipped",
      blocks: [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 17],
      // Since the first blocks are skipped, now the last blocks of the epoch are the checkpoint blocks
      maybeCheckpointBlocks: [0, 7, 15, 17],
    },
  ];

  for (const {id, blocks, maybeCheckpointBlocks: checkpointBlocks} of testCases) {
    it(id, () => {
      const checkpointBlocksSet = new Set(checkpointBlocks);
      const nonAncestorSlots = blocks.filter((slot) => !checkpointBlocksSet.has(slot));

      const nonAncestorBlocks = getNonCheckpointBlocks(blocks.map(toProtoBlock));

      expect(sort(nonAncestorBlocks.map((block) => block.slot))).to.deep.equal(sort(nonAncestorSlots));
    });
  }
});

function toProtoBlock(slot: Slot): {slot: Slot} {
  return {
    slot,
  };
}

function sort(nums: number[]): number[] {
  return nums.sort((a, b) => a - b);
}
