import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {EventType, getEventSerdes} from "../../../src/beacon/routes/events.js";

describe("beacon / events serdes", () => {
  const config = createChainForkConfig({...configDef, GLOAS_FORK_EPOCH: 0});
  const serdes = getEventSerdes(config);

  describe("payload_attributes", () => {
    const data = ssz.gloas.SSEPayloadAttributes.defaultValue();

    it("round trips without fork choice hashes", () => {
      const message = {version: ForkName.gloas, data};
      const json = serdes.toJson({type: EventType.payloadAttributes, message});
      expect(json).not.toHaveProperty("safe_block_hash");
      expect(serdes.fromJson(EventType.payloadAttributes, json)).toEqual(message);
    });

    it("round trips with fork choice hashes", () => {
      const message = {
        version: ForkName.gloas,
        data,
        safeBlockHash: "0x" + "aa".repeat(32),
        finalizedBlockHash: "0x" + "bb".repeat(32),
      };
      const json = serdes.toJson({type: EventType.payloadAttributes, message}) as Record<string, unknown>;
      expect(json.safe_block_hash).toEqual(message.safeBlockHash);
      expect(json.finalized_block_hash).toEqual(message.finalizedBlockHash);
      expect(serdes.fromJson(EventType.payloadAttributes, json)).toEqual(message);
    });
  });

  describe("block", () => {
    it("round trips without the committed bid", () => {
      const message = {slot: 1, block: "0x" + "cc".repeat(32), executionOptimistic: false};
      const json = serdes.toJson({type: EventType.block, message});
      expect(json).toEqual({slot: "1", block: message.block, execution_optimistic: false});
      expect(serdes.fromJson(EventType.block, json)).toEqual(message);
    });

    it("round trips with the committed bid", () => {
      const message = {
        slot: 1,
        block: "0x" + "cc".repeat(32),
        executionOptimistic: false,
        builderIndex: 5,
        blockHash: "0x" + "dd".repeat(32),
      };
      const json = serdes.toJson({type: EventType.block, message}) as Record<string, unknown>;
      expect(json.builder_index).toEqual("5");
      expect(json.block_hash).toEqual(message.blockHash);
      expect(serdes.fromJson(EventType.block, json)).toEqual(message);
    });

    it("round trips a self-build builder index", () => {
      const message = {
        slot: 1,
        block: "0x" + "cc".repeat(32),
        executionOptimistic: false,
        builderIndex: BUILDER_INDEX_SELF_BUILD,
        blockHash: "0x" + "dd".repeat(32),
      };
      const json = serdes.toJson({type: EventType.block, message}) as Record<string, unknown>;
      expect(json.builder_index).toEqual("18446744073709551615");
      expect(serdes.fromJson(EventType.block, json)).toEqual(message);
    });
  });
});
