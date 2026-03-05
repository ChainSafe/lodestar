import {describe, expect, it} from "vitest";
import {getEngineSszRequestDescriptor} from "../../../../src/execution/engine/sszEndpointMap.js";

describe("execution / engine / sszEndpointMap", () => {
  it("maps fixed POST methods to versioned engine SSZ endpoints", () => {
    const d = getEngineSszRequestDescriptor("engine_newPayloadV3", ["0x01" as never, [] as never, "0x02" as never]);

    expect(d).toEqual({httpMethod: "POST", path: "/engine/v3/payloads"});
  });

  it("maps getPayload methods to GET endpoints with payload id path", () => {
    const d = getEngineSszRequestDescriptor("engine_getPayloadV4", ["0xABCD" as never]);

    expect(d).toEqual({httpMethod: "GET", path: "/engine/v4/payloads/0xabcd"});
  });

  it("throws if payload id format is invalid", () => {
    expect(() => getEngineSszRequestDescriptor("engine_getPayloadV1", ["abcd" as never])).toThrow(
      "Invalid payloadId format"
    );
  });
});
