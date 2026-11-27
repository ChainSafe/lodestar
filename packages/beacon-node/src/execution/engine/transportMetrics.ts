import {Counter, Histogram} from "@lodestar/utils";

/**
 * Common metrics type for both json rpc and ssz transport.
 */
export type EngineTransportMetrics = {
  requestBytes: Counter<{routeId: string}>;
  responseBytes: Counter<{routeId: string}>;
  responseParseTime: Histogram<{routeId: string; encoding: "json" | "ssz"}>;
};
