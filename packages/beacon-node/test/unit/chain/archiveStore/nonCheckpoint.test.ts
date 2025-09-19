import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {beforeAll, describe, expect, it} from "vitest";
import {getNonCheckpointBlocks} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";

describe("chain / archive / getNonCheckpointBlocks", () => {
  beforeAll(() => {
    expect(SLOTS_PER_EPOCH).toBe(32);
  });

  const testCases: {id: string; blocks: Slot[]; maybeCheckpointSlots: Slot[]}[] = [
    {id: "empty", blocks: [], maybeCheckpointSlots: []},
    {id: "one block", blocks: [16], maybeCheckpointSlots: [16]},
    {id: "one block in first slot", blocks: [0], maybeCheckpointSlots: [0]},
    {id: "one block per epoch", blocks: [16, 48, 80], maybeCheckpointSlots: [16, 48, 80]},
    {id: "two blocks per epoch", blocks: [16, 20, 48, 52, 80, 84], maybeCheckpointSlots: [20, 52, 84]},
    {
      id: "linear sequence of blocks",
      blocks: [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
        30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
        58, 59, 60, 61, 62, 63, 64, 65,
      ],
      maybeCheckpointSlots: [0, 32, 64, 65],
    },
    {
      id: "linear sequence of blocks, first block skipped",
      blocks: [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
        30, 31, /*32*/ 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
        57, 58, 59, 60, 61, 62, 63, /*64*/ 65,
      ],
      // Since the first blocks are skipped, now the last blocks of the epoch are the checkpoint blocks
      maybeCheckpointSlots: [0, 31, 63, 65],
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
