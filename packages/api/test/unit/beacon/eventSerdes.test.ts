import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {EventType, getEventSerdes} from "../../../src/beacon/routes/events.js";

describe("beacon / events serdes", () => {
  const serdes = getEventSerdes(config);

  describe("payload_attributes", () => {
    const safeBlockHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const finalizedBlockHash = "0x2222222222222222222222222222222222222222222222222222222222222222";

    it("round trips the standard shape without forkchoice hashes", () => {
      const message = {version: ForkName.fulu, data: ssz.fulu.SSEPayloadAttributes.defaultValue()};
      const json = serdes.toJson({type: EventType.payloadAttributes, message});

      expect(json).not.toHaveProperty("safe_block_hash");
      expect(json).not.toHaveProperty("finalized_block_hash");
      expect(serdes.fromJson(EventType.payloadAttributes, json)).toEqual(message);
    });

    it.each([ForkName.gloas, ForkName.heze] as const)("round trips %s attributes with forkchoice hashes", (fork) => {
      const message = {
        version: fork,
        data: ssz[fork].SSEPayloadAttributes.defaultValue(),
        safeBlockHash,
        finalizedBlockHash,
      };
      const json = serdes.toJson({type: EventType.payloadAttributes, message}) as Record<string, unknown>;

      expect(json.safe_block_hash).toBe(safeBlockHash);
      expect(json.finalized_block_hash).toBe(finalizedBlockHash);
      // The hashes are an extension next to the standard fields, not part of `data`
      expect(json.data).not.toHaveProperty("safe_block_hash");
      expect(json.data).not.toHaveProperty("finalized_block_hash");
      expect(serdes.fromJson(EventType.payloadAttributes, json)).toEqual(message);
    });

    it("parses post-gloas events from beacon nodes that do not send forkchoice hashes", () => {
      const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
      const json = {version: ForkName.gloas, data: ssz.gloas.SSEPayloadAttributes.toJson(data)};
      const message = serdes.fromJson(EventType.payloadAttributes, json);

      expect(message).toEqual({version: ForkName.gloas, data});
      expect(message).not.toHaveProperty("safeBlockHash");
      expect(message).not.toHaveProperty("finalizedBlockHash");
    });
  });
});
