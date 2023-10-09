import {describe, it, expect, beforeAll} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {getNonCheckpointBlocks} from "../../../../src/chain/archiver/archiveBlocks.js";

describe("chain / archive / getNonCheckpointBlocks", () => {
  beforeAll(() => {
    expect(SLOTS_PER_EPOCH).toBe(8);
  });

  const testCases: {id: string; blocks: Slot[]; maybeCheckpointSlots: Slot[]}[] = [
    {id: "empty", blocks: [], maybeCheckpointSlots: []},
    {id: "one block", blocks: [4], maybeCheckpointSlots: [4]},
    {id: "one block in first slot", blocks: [0], maybeCheckpointSlots: [0]},
    {id: "one block per epoch", blocks: [4, 12, 20], maybeCheckpointSlots: [4, 12, 20]},
    {id: "two blocks per epoch", blocks: [4, 5, 12, 13, 20, 21], maybeCheckpointSlots: [5, 13, 21]},
    {
      id: "linear sequence of blocks",
      blocks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      maybeCheckpointSlots: [0, 8, 16, 17],
    },
    {
      id: "linear sequence of blocks, first block skipped",
      blocks: [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 17],
      // Since the first blocks are skipped, now the last blocks of the epoch are the checkpoint blocks
      maybeCheckpointSlots: [0, 7, 15, 17],
    },
  ];

  for (const {id, blocks, maybeCheckpointSlots} of testCases) {
    it(id, () => {
      const checkpointBlocksSet = new Set(maybeCheckpointSlots);
      const nonCheckpointSlots = blocks.filter((slot) => !checkpointBlocksSet.has(slot));

      // blocks are to be passed in reverse order as thats how they would be recieved in
      // ProtoArray.getAllAncestorNodes
      const nonAncestorBlocks = getNonCheckpointBlocks(blocks.reverse().map(toProtoBlock));

      expect(sort(nonAncestorBlocks.map((block) => block.slot))).toEqual(sort(nonCheckpointSlots));
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
