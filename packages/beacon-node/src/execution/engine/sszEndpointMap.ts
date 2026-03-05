/* biome-ignore-all lint/style/useNamingConvention: Engine API method names are protocol-defined. */
import type {EngineApiRpcParamTypes} from "./types.js";

export type EngineApiMethod = keyof EngineApiRpcParamTypes;
export type EngineSszHttpMethod = "GET" | "POST";

export type EngineSszRequestDescriptor = {
  httpMethod: EngineSszHttpMethod;
  path: string;
};

const FIXED_METHOD_TO_ENDPOINT: Partial<Record<EngineApiMethod, EngineSszRequestDescriptor>> = {
  engine_newPayloadV1: {httpMethod: "POST", path: "/engine/v1/payloads"},
  engine_newPayloadV2: {httpMethod: "POST", path: "/engine/v2/payloads"},
  engine_newPayloadV3: {httpMethod: "POST", path: "/engine/v3/payloads"},
  engine_newPayloadV4: {httpMethod: "POST", path: "/engine/v4/payloads"},

  engine_forkchoiceUpdatedV1: {httpMethod: "POST", path: "/engine/v1/forkchoice"},
  engine_forkchoiceUpdatedV2: {httpMethod: "POST", path: "/engine/v2/forkchoice"},
  engine_forkchoiceUpdatedV3: {httpMethod: "POST", path: "/engine/v3/forkchoice"},

  engine_getPayloadBodiesByHashV1: {httpMethod: "POST", path: "/engine/v1/payloads/bodies/by-hash"},
  engine_getPayloadBodiesByRangeV1: {httpMethod: "POST", path: "/engine/v1/payloads/bodies/by-range"},

  engine_getClientVersionV1: {httpMethod: "POST", path: "/engine/v1/client/version"},

  engine_getBlobsV1: {httpMethod: "POST", path: "/engine/v1/blobs"},
  engine_getBlobsV2: {httpMethod: "POST", path: "/engine/v2/blobs"},
};

/**
 * Engine API Binary SSZ transport endpoint mapping.
 *
 * Reference: execution-apis PR #764 (src/engine/ssz-encoding.md)
 *
 * Note: For methods without a mapping, the caller should fallback to existing
 * JSON-RPC transport.
 */
export function getEngineSszRequestDescriptor(
  method: EngineApiMethod,
  params: EngineApiRpcParamTypes[EngineApiMethod]
): EngineSszRequestDescriptor | null {
  switch (method) {
    case "engine_getPayloadV1":
      return {httpMethod: "GET", path: `/engine/v1/payloads/${normalizePayloadId(params[0] as string)}`};
    case "engine_getPayloadV2":
      return {httpMethod: "GET", path: `/engine/v2/payloads/${normalizePayloadId(params[0] as string)}`};
    case "engine_getPayloadV3":
      return {httpMethod: "GET", path: `/engine/v3/payloads/${normalizePayloadId(params[0] as string)}`};
    case "engine_getPayloadV4":
      return {httpMethod: "GET", path: `/engine/v4/payloads/${normalizePayloadId(params[0] as string)}`};
    case "engine_getPayloadV5":
      return {httpMethod: "GET", path: `/engine/v5/payloads/${normalizePayloadId(params[0] as string)}`};
    default:
      return FIXED_METHOD_TO_ENDPOINT[method] ?? null;
  }
}

function normalizePayloadId(payloadId: string): string {
  if (typeof payloadId !== "string" || !payloadId.startsWith("0x")) {
    throw Error(`Invalid payloadId format: ${String(payloadId)}`);
  }
  return payloadId.toLowerCase();
}
