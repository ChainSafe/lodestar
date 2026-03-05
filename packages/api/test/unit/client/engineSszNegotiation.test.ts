import {describe, expect, it} from "vitest";
import {getEngineSszMethodDescriptor} from "../../../src/utils/client/engineSszMethodMap.js";
import {EngineSszNegotiationState} from "../../../src/utils/client/engineSszNegotiation.js";

describe("api / client / engineSszNegotiation", () => {
  it("only enables SSZ for mutually advertised endpoints", () => {
    const clCapabilities = [
      "POST /engine/v3/payloads",
      "POST /engine/v3/forkchoice",
      "GET /engine/v5/payloads/{payload_id}",
    ];

    const state = new EngineSszNegotiationState(clCapabilities);

    state.updateFromElCapabilities(["POST /engine/v3/payloads", "engine_newPayloadV3"]);

    expect(state.isMethodSupported("engine_newPayloadV3")).toBe(true);
    expect(state.isMethodSupported("engine_forkchoiceUpdatedV3")).toBe(false);
    expect(state.isMethodSupported("engine_getPayloadV5")).toBe(false);
  });

  it("checks support using method descriptor capability", () => {
    const state = new EngineSszNegotiationState(["GET /engine/v5/payloads/{payload_id}", "POST /engine/v3/forkchoice"]);

    state.updateFromElCapabilities(["GET /engine/v5/payloads/{payload_id}"]);

    const getPayloadDescriptor = getEngineSszMethodDescriptor("engine_getPayloadV5", ["0xAABB"]);
    const fcuDescriptor = getEngineSszMethodDescriptor("engine_forkchoiceUpdatedV3", [{}, {}]);

    if (getPayloadDescriptor === null || fcuDescriptor === null) {
      throw Error("Expected method descriptors to be present");
    }

    expect(state.isDescriptorSupported(getPayloadDescriptor)).toBe(true);
    expect(state.isDescriptorSupported(fcuDescriptor)).toBe(false);
  });

  it("maps EL method-name capabilities to SSZ endpoint negotiation", () => {
    const state = new EngineSszNegotiationState([
      "POST /engine/v1/client/version",
      "GET /engine/v5/payloads/{payload_id}",
    ]);

    state.updateFromElCapabilities(["engine_getClientVersionV1", "engine_getPayloadV5"]);

    expect(state.isMethodSupported("engine_getClientVersionV1")).toBe(true);
    expect(state.isMethodSupported("engine_getPayloadV5")).toBe(true);
  });
});
