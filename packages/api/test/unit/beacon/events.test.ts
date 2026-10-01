import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {EventData, EventType, getTypeByEvent} from "../../../src/beacon/routes/events.js";

describe("beacon / events / block codec", () => {
  const blockRoot = "0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf";
  const blockHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  describe("post-gloas", () => {
    const blockType = getTypeByEvent(createChainForkConfig({...defaultChainConfig, GLOAS_FORK_EPOCH: 0}))[
      EventType.block
    ];

    it("round-trips a builder bid", () => {
      const event: EventData[EventType.block] = {
        slot: 10,
        block: blockRoot,
        blockHash,
        builderIndex: 1,
        executionOptimistic: false,
      };
      const json = blockType.toJson(event);

      expect(json).toEqual({
        slot: "10",
        block: blockRoot,
        block_hash: blockHash,
        builder_index: "1",
        execution_optimistic: false,
      });
      expect(blockType.fromJson(json)).toEqual(event);
    });

    it("serializes a self-built bid as UINT64_MAX and decodes it back", () => {
      const event: EventData[EventType.block] = {
        slot: 10,
        block: blockRoot,
        blockHash,
        builderIndex: BUILDER_INDEX_SELF_BUILD,
        executionOptimistic: false,
      };
      const json = blockType.toJson(event);

      expect((json as {builder_index: string}).builder_index).toBe("18446744073709551615");
      expect(blockType.fromJson(json)).toEqual(event);
    });
  });

  describe("pre-gloas", () => {
    const blockType = getTypeByEvent(createChainForkConfig(defaultChainConfig))[EventType.block];

    it("omits builder fields", () => {
      const json = blockType.toJson({
        slot: 10,
        block: blockRoot,
        blockHash,
        builderIndex: 1,
        executionOptimistic: false,
      });

      expect(json).toEqual({slot: "10", block: blockRoot, execution_optimistic: false});
      expect(blockType.fromJson(json)).toEqual({slot: 10, block: blockRoot, executionOptimistic: false});
    });
  });
});
