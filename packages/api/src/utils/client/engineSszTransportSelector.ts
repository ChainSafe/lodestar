import type {EngineSszMethodDescriptor} from "./engineSszMethodMap.js";
import {getEngineSszMethodDescriptor} from "./engineSszMethodMap.js";
import type {EngineSszNegotiationState} from "./engineSszNegotiation.js";

export type EngineTransportSelection =
  | {transport: "ssz"; descriptor: EngineSszMethodDescriptor}
  | {transport: "json-rpc"; reason: "method-not-mapped" | "endpoint-not-negotiated"};

/**
 * Select transport for an Engine API method invocation.
 *
 * - Uses SSZ when method is mapped to an SSZ endpoint AND that endpoint was
 *   mutually advertised via engine_exchangeCapabilities.
 * - Falls back to JSON-RPC otherwise.
 */
export function selectEngineTransport(
  method: string,
  params: unknown[],
  negotiation: EngineSszNegotiationState
): EngineTransportSelection {
  const descriptor = getEngineSszMethodDescriptor(method, params);

  if (descriptor === null) {
    return {transport: "json-rpc", reason: "method-not-mapped"};
  }

  if (!negotiation.isDescriptorSupported(descriptor)) {
    return {transport: "json-rpc", reason: "endpoint-not-negotiated"};
  }

  return {transport: "ssz", descriptor};
}
