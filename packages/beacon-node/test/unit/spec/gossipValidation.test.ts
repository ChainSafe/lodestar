import {afterEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName, SLOTS_PER_EPOCH, ZERO_HASH_HEX} from "@lodestar/params";
import {
  AttestationError,
  AttestationErrorCode,
  BlockErrorCode,
  BlockGossipError,
  GossipAction,
} from "../../../src/chain/errors/index.js";
import {Clock} from "../../../src/util/clock.js";
import {GossipTestClock, gossipValidationResult, runGossipValidationTest} from "../../spec/utils/gossipValidation.js";

describe("gossip fixture error adaptation", () => {
  const parentRoot = ZERO_HASH_HEX;
  const unknownParent = new BlockGossipError(GossipAction.IGNORE, {
    code: BlockErrorCode.PARENT_BLOCK_UNKNOWN,
    parentRoot,
  });
  const unimported = new Map([[parentRoot, {block: "parent", failed: true}]]);

  it.each([new Error("unexpected"), new TypeError("bad access"), new RangeError("out of bounds")])(
    "does not turn %s into a successful rejection",
    (error) => {
      expect(() => gossipValidationResult(error, ForkName.deneb, unimported)).toThrow(error);
    }
  );

  it("does not change the result for an unknown parent absent from the fixtures", () => {
    expect(gossipValidationResult(unknownParent, ForkName.deneb, new Map())).toBe("ignore");
  });

  it.each(["failed", "pending"] as const)("adapts an explicitly %s parent without importing it", (flag) => {
    expect(
      gossipValidationResult(unknownParent, ForkName.deneb, new Map([[parentRoot, {block: "parent", [flag]: true}]]))
    ).toBe("reject");
  });

  it.each(["VALID", "INVALIDATED"] as const)("ignores a consensus-invalid parent with %s payload", (payloadStatus) => {
    const blocks = new Map([[parentRoot, {block: "parent", failed: true, payload_status: payloadStatus}]]);
    expect(gossipValidationResult(unknownParent, ForkName.bellatrix, blocks)).toBe("ignore");
    expect(gossipValidationResult(unknownParent, ForkName.phase0, blocks)).toBe("reject");
  });

  it("does not adapt other validation failures for a known failed parent", () => {
    const future = new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.FUTURE_SLOT,
      currentSlot: 1,
      blockSlot: 2,
    });
    expect(gossipValidationResult(future, ForkName.deneb, unimported)).toBe("ignore");
    const invalidPayload = new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.PARENT_EXECUTION_INVALID,
      parentRoot,
    });
    expect(gossipValidationResult(invalidPayload, ForkName.deneb, unimported)).toBe("ignore");
  });

  it("adapts unknown attested blocks only when explicitly unimported", () => {
    const error = new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT,
      root: parentRoot,
    });
    expect(gossipValidationResult(error, ForkName.deneb, unimported)).toBe("reject");
    expect(gossipValidationResult(error, ForkName.deneb, new Map())).toBe("ignore");
  });

  it("fails on missing fixture files", async () => {
    await expect(
      runGossipValidationTest(ForkName.phase0, "gossip_beacon_block", "/missing-gossip-fixture")
    ).rejects.toMatchObject({code: "ENOENT"});
  });
});

describe("gossip fixture clock", () => {
  afterEach(() => vi.restoreAllMocks());

  it("matches the production clock at inclusive slot and epoch boundaries", () => {
    const genesisTime = 1000;
    const slotDuration = config.SLOT_DURATION_MS;
    const disparity = config.MAXIMUM_GOSSIP_CLOCK_DISPARITY;
    const now = vi.spyOn(Date, "now").mockReturnValue(genesisTime * 1000);
    const controller = new AbortController();
    const clock = new Clock({config, genesisTime, signal: controller.signal});
    controller.abort();
    const fixtureClock = new GossipTestClock(genesisTime, slotDuration / 1000, disparity);

    for (const slot of [1, SLOTS_PER_EPOCH, SLOTS_PER_EPOCH * 2]) {
      for (const offset of [-disparity - 1, -disparity, -1, 0, 1, disparity, disparity + 1]) {
        const time = slot * slotDuration + offset;
        now.mockReturnValue(genesisTime * 1000 + time);
        fixtureClock.setCurrentTimeMs(time);
        const context = `slot=${slot}, offset=${offset}`;
        expect(fixtureClock.currentSlot, context).toBe(clock.currentSlot);
        expect(fixtureClock.currentEpoch, context).toBe(clock.currentEpoch);
        expect(fixtureClock.currentSlotWithGossipDisparity, context).toBe(clock.currentSlotWithGossipDisparity);
        expect(fixtureClock.slotWithPastTolerance(disparity / 1000), context).toBe(
          clock.slotWithPastTolerance(disparity / 1000)
        );
        expect(fixtureClock.slotWithFutureTolerance(disparity / 1000), context).toBe(
          clock.slotWithFutureTolerance(disparity / 1000)
        );
        expect(fixtureClock.msFromSlot(slot), context).toBe(clock.msFromSlot(slot));
        expect(fixtureClock.secFromSlot(slot), context).toBe(clock.secFromSlot(slot));
        for (const candidate of [slot - 1, slot, slot + 1]) {
          expect(fixtureClock.isCurrentSlotGivenGossipDisparity(candidate), `${context}, candidate=${candidate}`).toBe(
            clock.isCurrentSlotGivenGossipDisparity(candidate)
          );
        }
      }
    }
  });
});
