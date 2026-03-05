import {getUniqueEngineSszCapabilitiesForMethods} from "./engineSszMethodMap.js";

/**
 * Engine API methods currently used by Lodestar beacon-node execution engine client.
 *
 * Source: packages/beacon-node/src/execution/engine/http.ts
 */
export const LODESTAR_ENGINE_METHODS_IN_USE = [
  "engine_newPayloadV1",
  "engine_newPayloadV2",
  "engine_newPayloadV3",
  "engine_newPayloadV4",
  "engine_forkchoiceUpdatedV1",
  "engine_forkchoiceUpdatedV2",
  "engine_forkchoiceUpdatedV3",
  "engine_getPayloadV1",
  "engine_getPayloadV2",
  "engine_getPayloadV3",
  "engine_getPayloadV4",
  "engine_getPayloadV5",
  "engine_getPayloadBodiesByHashV1",
  "engine_getPayloadBodiesByRangeV1",
  "engine_getBlobsV1",
  "engine_getBlobsV2",
  "engine_getClientVersionV1",
] as const;

/**
 * SSZ REST capabilities Lodestar should advertise via engine_exchangeCapabilities.
 */
export const LODESTAR_ENGINE_SSZ_CAPABILITIES = getUniqueEngineSszCapabilitiesForMethods([
  ...LODESTAR_ENGINE_METHODS_IN_USE,
]);
