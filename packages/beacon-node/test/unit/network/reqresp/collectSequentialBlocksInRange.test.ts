import {describe, it, expect} from "vitest";
import {allForks, phase0, ssz} from "@lodestar/types";
import {ResponseIncoming} from "@lodestar/reqresp";
import {ForkName} from "@lodestar/params";
import {
  BlocksByRangeError,
  BlocksByRangeErrorCode,
  collectSequentialBlocksInRange,
} from "../../../../src/network/reqresp/utils/collectSequentialBlocksInRange.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";

describe("beacon-node / network / reqresp / utils / collectSequentialBlocksInRange", () => {
  const testCases: {
    id: string;
    slots: number[];
    request: Pick<phase0.BeaconBlocksByRangeRequest, "count" | "startSlot">;
    error?: BlocksByRangeError;
  }[] = [
    {
      id: "Full range",
      slots: [1, 2, 3],
      request: {startSlot: 1, count: 3},
    },
    {
      id: "Range with skipped slots",
      slots: [1, 3],
      request: {startSlot: 1, count: 3},
    },
    {
      id: "Empty range",
      slots: [],
      request: {startSlot: 1, count: 3},
    },
    {
      id: "Slot under start slot",
      slots: [0, 1],
      request: {startSlot: 1, count: 3},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.UNDER_START_SLOT}),
    },
    {
      id: "Slot over max",
      slots: [3, 4],
      request: {startSlot: 1, count: 3},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.OVER_MAX_SLOT}),
    },
    {
      id: "Bad sequence - duplicate slots",
      slots: [1, 1, 3],
      request: {startSlot: 1, count: 3},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_SEQUENCE}),
    },
    {
      id: "Bad sequence - partial reverse",
      slots: [2, 1, 4],
      request: {startSlot: 1, count: 3},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_SEQUENCE}),
    },
    {
      id: "Reverse order",
      slots: [3, 2, 1],
      request: {startSlot: 1, count: 3},
      error: new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_SEQUENCE}),
    },
  ];

  for (const {id, slots, request, error} of testCases) {
    it(id, async () => {
      const blocks = slots.map((slot) => {
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = slot;
        return block;
      });

      if (error) {
        await expectRejectedWithLodestarError(collectSequentialBlocksInRange(arrToSource(blocks), request), error);
      } else {
        await expect(collectSequentialBlocksInRange(arrToSource(blocks), request)).resolves.toBeDefined();
      }
    });
  }

  async function* arrToSource(arr: allForks.SignedBeaconBlock[]): AsyncGenerator<ResponseIncoming> {
    for (const item of arr) {
      yield {data: ssz.phase0.SignedBeaconBlock.serialize(item), fork: ForkName.phase0, protocolVersion: 1};
    }
  }
});
