import {phase0} from "@chainsafe/lodestar-types";
import {
  assertSequentialBlocksInRange,
  BlocksByRangeError,
  BlocksByRangeErrorCode,
} from "../../../../../src/network/reqresp/utils";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {expectThrowsLodestarError} from "../../../../utils/errors";

describe("network / reqResp / utils / assertSequentialBlocksInRange", () => {
  const testCases: {
    id: string;
    slots: number[];
    request: phase0.BeaconBlocksByRangeRequest;
    error?: BlocksByRangeError;
  }[] = [
    {
      id: "Full range",
      slots: [1, 2, 3],
      request: {startSlot: 1, count: 3, step: 1},
    },
    {
      id: "Full range step > 1",
      slots: [1, 4, 9],
      request: {startSlot: 1, count: 3, step: 3},
    },
    {
      id: "Range with skipped slots",
      slots: [1, 3],
      request: {startSlot: 1, count: 3, step: 1},
    },
    {
      id: "Empty range",
      slots: [],
      request: {startSlot: 1, count: 3, step: 1},
    },
    {
      id: "Length too big",
      slots: [1, 2, 3, 4],
      request: {startSlot: 1, count: 3, step: 1},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_LENGTH, count: 3, length: 4}),
    },
    {
      id: "Slot under start slot",
      slots: [0, 1],
      request: {startSlot: 1, count: 3, step: 1},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.UNDER_START_SLOT, startSlot: 1, firstSlot: 0}),
    },
    {
      id: "Slot over max",
      slots: [3, 4],
      request: {startSlot: 1, count: 3, step: 1},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.OVER_MAX_SLOT, maxSlot: 3, lastSlot: 4}),
    },
    {
      id: "Bad sequence",
      slots: [1, 2, 3],
      request: {startSlot: 1, count: 3, step: 2},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_SEQUENCE, step: 2, slotL: 1, slotR: 2}),
    },
    {
      id: "Reverse order",
      slots: [3, 2, 1],
      request: {startSlot: 1, count: 3, step: 1},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_SEQUENCE, step: 1, slotL: 3, slotR: 2}),
    },
  ];

  for (const {id, slots, request, error} of testCases) {
    it(id, () => {
      const blocks = slots.map((slot) => {
        const block = generateEmptySignedBlock();
        block.message.slot = slot;
        return block;
      });

      if (error) {
        expectThrowsLodestarError(() => assertSequentialBlocksInRange(blocks, request), error);
      } else {
        assertSequentialBlocksInRange(blocks, request);
      }
    });
  }
});
