import {describe, expect, it} from "vitest";
import {EngineSszNegotiationState} from "../../../src/utils/client/engineSszNegotiation.js";
import {selectEngineTransport} from "../../../src/utils/client/engineSszTransportSelector.js";

describe("api / client / engineSszTransportSelector", () => {
  it("returns SSZ when method is mapped and endpoint is negotiated", () => {
    const negotiation = new EngineSszNegotiationState(["POST /engine/v3/payloads", "POST /engine/v3/forkchoice"]);
    negotiation.updateFromElCapabilities(["POST /engine/v3/payloads"]);

    const selection = selectEngineTransport("engine_newPayloadV3", ["0x01", [], "0x02"], negotiation);

    expect(selection).toEqual({
      transport: "ssz",
      descriptor: {
        httpMethod: "POST",
        path: "/engine/v3/payloads",
        capability: "POST /engine/v3/payloads",
      },
    });
  });

  it("falls back to JSON-RPC when method has no SSZ mapping", () => {
    const negotiation = new EngineSszNegotiationState(["POST /engine/v1/payloads"]);
    negotiation.updateFromElCapabilities(["POST /engine/v1/payloads"]);

    const selection = selectEngineTransport("engine_exchangeCapabilities", [[]], negotiation);

    expect(selection).toEqual({transport: "json-rpc", reason: "method-not-mapped"});
  });

  it("falls back to JSON-RPC when endpoint is not negotiated", () => {
    const negotiation = new EngineSszNegotiationState(["POST /engine/v3/payloads", "POST /engine/v3/forkchoice"]);
    negotiation.updateFromElCapabilities(["POST /engine/v3/payloads"]);

    const selection = selectEngineTransport(
      "engine_forkchoiceUpdatedV3",
      [{headBlockHash: "0x", safeBlockHash: "0x", finalizedBlockHash: "0x"}, null],
      negotiation
    );

    expect(selection).toEqual({transport: "json-rpc", reason: "endpoint-not-negotiated"});
  });
});
