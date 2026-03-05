import {describe, expect, it} from "vitest";
import {
  getEngineSszMethodDescriptor,
  getUniqueEngineSszCapabilitiesForMethods,
  getUniqueEngineSszCapabilitiesFromElCapabilities,
} from "../../../src/utils/client/engineSszMethodMap.js";

describe("api / client / engineSszMethodMap", () => {
  it("maps fixed POST methods", () => {
    const d = getEngineSszMethodDescriptor("engine_forkchoiceUpdatedV3", [{}, {}]);

    expect(d).toEqual({
      httpMethod: "POST",
      path: "/engine/v3/forkchoice",
      capability: "POST /engine/v3/forkchoice",
    });
  });

  it("maps getPayload methods with payload_id path and capability template", () => {
    const d = getEngineSszMethodDescriptor("engine_getPayloadV5", ["0xABCDEF0123"]);

    expect(d).toEqual({
      httpMethod: "GET",
      path: "/engine/v5/payloads/0xabcdef0123",
      capability: "GET /engine/v5/payloads/{payload_id}",
    });
  });

  it("returns null for non-mapped methods", () => {
    expect(getEngineSszMethodDescriptor("engine_exchangeCapabilities", [[]])).toBeNull();
  });

  it("throws for invalid payloadId", () => {
    expect(() => getEngineSszMethodDescriptor("engine_getPayloadV1", ["abc"])).toThrow("Invalid payloadId format");
  });

  it("extracts unique negotiated-capability set from engine method list", () => {
    const caps = getUniqueEngineSszCapabilitiesForMethods([
      "engine_newPayloadV3",
      "engine_getPayloadV5",
      "engine_newPayloadV3",
      "engine_exchangeCapabilities",
    ]);

    expect(caps).toEqual(["POST /engine/v3/payloads", "GET /engine/v5/payloads/{payload_id}"]);
  });

  it("derives endpoint capabilities from EL method-name capability list", () => {
    const caps = getUniqueEngineSszCapabilitiesFromElCapabilities([
      "engine_getPayloadV5",
      "engine_getClientVersionV1",
      "engine_exchangeCapabilities",
      "POST /engine/v2/payloads",
    ]);

    expect(caps).toEqual(["GET /engine/v5/payloads/{payload_id}", "POST /engine/v1/client/version"]);
  });
});
