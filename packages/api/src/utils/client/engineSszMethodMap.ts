/* biome-ignore-all lint/style/useNamingConvention: Engine API method names are protocol-defined. */
import type {EngineSszEndpoint} from "./engineSszCapabilities.js";

export type EngineSszHttpMethod = "GET" | "POST";

export type EngineSszMethodDescriptor = {
  httpMethod: EngineSszHttpMethod;
  /** Concrete request path for this invocation */
  path: string;
  /** Capability string used by engine_exchangeCapabilities negotiation */
  capability: EngineSszEndpoint;
};

const FIXED_METHOD_MAP: Record<string, EngineSszMethodDescriptor> = {
  engine_newPayloadV1: {
    httpMethod: "POST",
    path: "/engine/v1/payloads",
    capability: "POST /engine/v1/payloads",
  },
  engine_newPayloadV2: {
    httpMethod: "POST",
    path: "/engine/v2/payloads",
    capability: "POST /engine/v2/payloads",
  },
  engine_newPayloadV3: {
    httpMethod: "POST",
    path: "/engine/v3/payloads",
    capability: "POST /engine/v3/payloads",
  },
  engine_newPayloadV4: {
    httpMethod: "POST",
    path: "/engine/v4/payloads",
    capability: "POST /engine/v4/payloads",
  },

  engine_forkchoiceUpdatedV1: {
    httpMethod: "POST",
    path: "/engine/v1/forkchoice",
    capability: "POST /engine/v1/forkchoice",
  },
  engine_forkchoiceUpdatedV2: {
    httpMethod: "POST",
    path: "/engine/v2/forkchoice",
    capability: "POST /engine/v2/forkchoice",
  },
  engine_forkchoiceUpdatedV3: {
    httpMethod: "POST",
    path: "/engine/v3/forkchoice",
    capability: "POST /engine/v3/forkchoice",
  },

  engine_getPayloadBodiesByHashV1: {
    httpMethod: "POST",
    path: "/engine/v1/payloads/bodies/by-hash",
    capability: "POST /engine/v1/payloads/bodies/by-hash",
  },
  engine_getPayloadBodiesByRangeV1: {
    httpMethod: "POST",
    path: "/engine/v1/payloads/bodies/by-range",
    capability: "POST /engine/v1/payloads/bodies/by-range",
  },

  engine_getClientVersionV1: {
    httpMethod: "POST",
    path: "/engine/v1/client/version",
    capability: "POST /engine/v1/client/version",
  },

  engine_getBlobsV1: {
    httpMethod: "POST",
    path: "/engine/v1/blobs",
    capability: "POST /engine/v1/blobs",
  },
  engine_getBlobsV2: {
    httpMethod: "POST",
    path: "/engine/v2/blobs",
    capability: "POST /engine/v2/blobs",
  },
};

const PAYLOAD_GET_METHODS: Record<string, {pathPrefix: string; capability: EngineSszEndpoint}> = {
  engine_getPayloadV1: {
    pathPrefix: "/engine/v1/payloads",
    capability: "GET /engine/v1/payloads/{payload_id}",
  },
  engine_getPayloadV2: {
    pathPrefix: "/engine/v2/payloads",
    capability: "GET /engine/v2/payloads/{payload_id}",
  },
  engine_getPayloadV3: {
    pathPrefix: "/engine/v3/payloads",
    capability: "GET /engine/v3/payloads/{payload_id}",
  },
  engine_getPayloadV4: {
    pathPrefix: "/engine/v4/payloads",
    capability: "GET /engine/v4/payloads/{payload_id}",
  },
  engine_getPayloadV5: {
    pathPrefix: "/engine/v5/payloads",
    capability: "GET /engine/v5/payloads/{payload_id}",
  },
};

export function getEngineSszCapabilityForMethod(method: string): EngineSszEndpoint | null {
  const fixed = FIXED_METHOD_MAP[method];
  if (fixed !== undefined) return fixed.capability;

  const payloadGet = PAYLOAD_GET_METHODS[method];
  if (payloadGet !== undefined) return payloadGet.capability;

  return null;
}

export function getUniqueEngineSszCapabilitiesForMethods(methods: string[]): EngineSszEndpoint[] {
  const set = new Set<EngineSszEndpoint>();
  for (const method of methods) {
    const capability = getEngineSszCapabilityForMethod(method);
    if (capability !== null) set.add(capability);
  }
  return [...set];
}

export function getUniqueEngineSszCapabilitiesFromElCapabilities(elCapabilities: string[]): EngineSszEndpoint[] {
  return getUniqueEngineSszCapabilitiesForMethods(
    elCapabilities.filter((value) => typeof value === "string" && value.startsWith("engine_"))
  );
}

export function getEngineSszMethodDescriptor(method: string, params: unknown[]): EngineSszMethodDescriptor | null {
  const fixed = FIXED_METHOD_MAP[method];
  if (fixed !== undefined) return fixed;

  const payloadGet = PAYLOAD_GET_METHODS[method];
  if (payloadGet !== undefined) {
    const payloadId = normalizePayloadId(params[0]);
    return {
      httpMethod: "GET",
      path: `${payloadGet.pathPrefix}/${payloadId}`,
      capability: payloadGet.capability,
    };
  }

  return null;
}

function normalizePayloadId(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw Error(`Invalid payloadId format: ${String(value)}`);
  }
  return value.toLowerCase();
}
