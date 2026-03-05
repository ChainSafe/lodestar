import {describe, expect, it} from "vitest";
import {
  type EngineSszEndpoint,
  getMutuallySupportedEngineSszCapabilities,
  isEngineSszCapability,
  isEngineSszEndpointSupported,
} from "../../../src/utils/client/engineSszCapabilities.js";

describe("api / client / engineSszCapabilities", () => {
  it("detects engine SSZ REST capability entries", () => {
    expect(isEngineSszCapability("POST /engine/v5/payloads")).toBe(true);
    expect(isEngineSszCapability("GET /engine/v6/payloads/{payload_id}")).toBe(true);
    expect(isEngineSszCapability("engine_newPayloadV4")).toBe(false);
  });

  it("computes mutual capability set with normalization", () => {
    const cl = ["POST /engine/v5/payloads", "POST /engine/v4/forkchoice", "GET /engine/v6/payloads/{payload_id}"];
    const el = ["post /engine/v5/payloads", "POST /engine/v4/forkchoice", "engine_forkchoiceUpdatedV4"];

    const supported = getMutuallySupportedEngineSszCapabilities(cl, el);

    expect(supported.size).toBe(2);
    expect(supported.has("POST /engine/v5/payloads" as EngineSszEndpoint)).toBe(true);
    expect(supported.has("POST /engine/v4/forkchoice" as EngineSszEndpoint)).toBe(true);
    expect(supported.has("GET /engine/v6/payloads/{payload_id}" as EngineSszEndpoint)).toBe(false);
  });

  it("checks endpoint support against negotiated set", () => {
    const supported = getMutuallySupportedEngineSszCapabilities(["POST /engine/v3/blobs"], ["POST /engine/v3/blobs"]);

    expect(isEngineSszEndpointSupported(supported, "POST /engine/v3/blobs" as EngineSszEndpoint)).toBe(true);
    expect(isEngineSszEndpointSupported(supported, "POST /engine/v2/blobs" as EngineSszEndpoint)).toBe(false);
  });
});
