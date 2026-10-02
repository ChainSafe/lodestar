import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
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

describe("beacon / events / payload_attributes codec", () => {
  const payloadAttributesType = getTypeByEvent(createChainForkConfig(defaultChainConfig))[EventType.payloadAttributes];
  const safeBlockHash = "0x" + "11".repeat(32);
  const finalizedBlockHash = "0x" + "22".repeat(32);

  it.each([ForkName.gloas, ForkName.heze] as const)("round-trips %s forkchoice hashes inside data", (fork) => {
    const event: EventData[EventType.payloadAttributes] = {
      version: fork,
      data: {
        ...ssz[fork].SSEPayloadAttributes.defaultValue(),
        safeBlockHash: fromHex(safeBlockHash),
        finalizedBlockHash: fromHex(finalizedBlockHash),
      },
    };
    const json = payloadAttributesType.toJson(event) as {data: Record<string, unknown>};

    expect(Object.keys(json.data)).toEqual([
      "proposer_index",
      "proposal_slot",
      "parent_block_root",
      "parent_block_hash",
      "safe_block_hash",
      "finalized_block_hash",
      "payload_attributes",
    ]);
    expect(json.data.safe_block_hash).toBe(safeBlockHash);
    expect(json.data.finalized_block_hash).toBe(finalizedBlockHash);
    expect(payloadAttributesType.fromJson(json)).toEqual(event);
  });

  it("rejects post-gloas events without forkchoice hashes", () => {
    const type = ssz.gloas.SSEPayloadAttributes;
    const {
      safe_block_hash: _safe,
      finalized_block_hash: _finalized,
      ...data
    } = type.toJson(type.defaultValue()) as Record<string, unknown>;

    expect(() => payloadAttributesType.fromJson({version: ForkName.gloas, data})).toThrow();
  });

  it("pre-gloas events do not carry forkchoice hashes", () => {
    const event: EventData[EventType.payloadAttributes] = {
      version: ForkName.fulu,
      data: ssz.fulu.SSEPayloadAttributes.defaultValue(),
    };
    const json = payloadAttributesType.toJson(event) as {data: Record<string, unknown>};

    expect(json.data).not.toHaveProperty("safe_block_hash");
    expect(json.data).not.toHaveProperty("finalized_block_hash");
    expect(payloadAttributesType.fromJson(json)).toEqual(event);
  });
});
