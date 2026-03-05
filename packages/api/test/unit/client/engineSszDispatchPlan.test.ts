import {describe, expect, it} from "vitest";
import {buildEngineDispatchPlan} from "../../../src/utils/client/engineSszDispatchPlan.js";
import {EngineSszNegotiationState} from "../../../src/utils/client/engineSszNegotiation.js";

describe("api / client / engineSszDispatchPlan", () => {
  it("returns SSZ dispatch plan for negotiated POST endpoint", () => {
    const negotiation = new EngineSszNegotiationState(["POST /engine/v3/payloads"]);
    negotiation.updateFromElCapabilities(["POST /engine/v3/payloads"]);

    const plan = buildEngineDispatchPlan(
      "engine_newPayloadV3",
      ["0x01", [], "0x02"],
      negotiation,
      () => new Uint8Array([7, 8, 9])
    );

    expect(plan.transport).toBe("ssz");
    if (plan.transport === "ssz") {
      expect(plan.request.method).toBe("POST");
      expect(plan.request.urlPath).toBe("/engine/v3/payloads");
      expect(plan.request.headers["Content-Type"]).toBe("application/octet-stream");
      expect(plan.request.body).toEqual(new Uint8Array([7, 8, 9]));
    }
  });

  it("returns JSON-RPC fallback plan when endpoint is not negotiated", () => {
    const negotiation = new EngineSszNegotiationState(["POST /engine/v3/payloads", "POST /engine/v3/forkchoice"]);
    negotiation.updateFromElCapabilities(["POST /engine/v3/payloads"]);

    const plan = buildEngineDispatchPlan("engine_forkchoiceUpdatedV3", [{}, null], negotiation);

    expect(plan).toEqual({transport: "json-rpc", reason: "endpoint-not-negotiated"});
  });

  it("builds GET SSZ plan without body", () => {
    const negotiation = new EngineSszNegotiationState(["GET /engine/v5/payloads/{payload_id}"]);
    negotiation.updateFromElCapabilities(["GET /engine/v5/payloads/{payload_id}"]);

    const plan = buildEngineDispatchPlan("engine_getPayloadV5", ["0xAABBCC"], negotiation);

    expect(plan.transport).toBe("ssz");
    if (plan.transport === "ssz") {
      expect(plan.request.method).toBe("GET");
      expect(plan.request.urlPath).toBe("/engine/v5/payloads/0xaabbcc");
      expect(plan.request.body).toBeUndefined();
    }
  });

  it("falls back to JSON-RPC when POST endpoint is negotiated but SSZ body is not encoded", () => {
    const negotiation = new EngineSszNegotiationState(["POST /engine/v3/payloads"]);
    negotiation.updateFromElCapabilities(["POST /engine/v3/payloads"]);

    const plan = buildEngineDispatchPlan("engine_newPayloadV3", ["0x01", [], "0x02"], negotiation);

    expect(plan).toEqual({transport: "json-rpc", reason: "ssz-body-not-encoded"});
  });
});
