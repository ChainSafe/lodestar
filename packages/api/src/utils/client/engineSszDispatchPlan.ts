import {type EngineSszRequestInit, buildEngineSszRequestInit} from "./engineSszHttp.js";
import {type EngineSszMethodDescriptor} from "./engineSszMethodMap.js";
import type {EngineSszNegotiationState} from "./engineSszNegotiation.js";
import {selectEngineTransport} from "./engineSszTransportSelector.js";

export type EngineSszBodyEncoder = (args: {
  method: string;
  params: unknown[];
  descriptor: EngineSszMethodDescriptor;
}) => Uint8Array | undefined;

export type EngineDispatchPlan =
  | {
      transport: "ssz";
      descriptor: EngineSszMethodDescriptor;
      request: EngineSszRequestInit;
    }
  | {
      transport: "json-rpc";
      reason: "method-not-mapped" | "endpoint-not-negotiated" | "ssz-body-not-encoded";
    };

/**
 * Build an execution dispatch plan for Engine API requests.
 *
 * - If method is mapped and negotiated, returns an SSZ request plan.
 * - Otherwise returns JSON-RPC fallback plan with explicit reason.
 */
export function buildEngineDispatchPlan(
  method: string,
  params: unknown[],
  negotiation: EngineSszNegotiationState,
  encodeBody?: EngineSszBodyEncoder
): EngineDispatchPlan {
  const selection = selectEngineTransport(method, params, negotiation);
  if (selection.transport === "json-rpc") {
    return selection;
  }

  const body = encodeBody?.({method, params, descriptor: selection.descriptor});

  if (selection.descriptor.httpMethod === "POST" && body === undefined) {
    return {transport: "json-rpc", reason: "ssz-body-not-encoded"};
  }

  const request = buildEngineSszRequestInit(selection.descriptor, body);
  return {
    transport: "ssz",
    descriptor: selection.descriptor,
    request,
  };
}
