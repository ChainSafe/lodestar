import {describe, expect, it} from "vitest";
import {
  LODESTAR_ENGINE_METHODS_IN_USE,
  LODESTAR_ENGINE_SSZ_CAPABILITIES,
} from "../../../src/utils/client/engineSszLodestarProfile.js";

describe("api / client / engineSszLodestarProfile", () => {
  it("tracks currently used beacon-node engine methods", () => {
    expect(LODESTAR_ENGINE_METHODS_IN_USE).toContain("engine_getPayloadBodiesByRangeV1");
    expect(LODESTAR_ENGINE_METHODS_IN_USE).toContain("engine_getBlobsV2");
    expect(LODESTAR_ENGINE_METHODS_IN_USE).not.toContain("engine_exchangeCapabilities");
  });

  it("derives deduplicated SSZ capability advertisement set", () => {
    expect(LODESTAR_ENGINE_SSZ_CAPABILITIES).toContain("POST /engine/v1/payloads/bodies/by-range");
    expect(LODESTAR_ENGINE_SSZ_CAPABILITIES).toContain("POST /engine/v2/blobs");
    expect(LODESTAR_ENGINE_SSZ_CAPABILITIES).toContain("GET /engine/v5/payloads/{payload_id}");

    const uniqueCount = new Set(LODESTAR_ENGINE_SSZ_CAPABILITIES).size;
    expect(uniqueCount).toBe(LODESTAR_ENGINE_SSZ_CAPABILITIES.length);
  });
});
