import {Gauge, GaugeExtra, Histogram} from "@lodestar/utils";

export type Metrics = {
  requestTime: Histogram<{routeId: string}>;
  streamTime: Histogram<{routeId: string}>;
  responseParseTime: Histogram<{routeId: string; encoding: "json" | "ssz"}>;
  requestErrors: Gauge<{routeId: string; baseUrl: string}>;
  requestToFallbacks: Gauge<{routeId: string; baseUrl: string}>;
  urlsScore: GaugeExtra<{urlIndex: number; baseUrl: string}>;
};
