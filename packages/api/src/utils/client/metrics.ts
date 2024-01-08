import {Gauge, GaugeExtra, Histogram} from "@lodestar/utils";

export type Metrics = {
  requestTime: Histogram<{routeId: string}>;
  streamTime: Histogram<{routeId: string}>;
  requestErrors: Gauge<{routeId: string}>;
  requestToFallbacks: Gauge<{routeId: string}>;
  urlsScore: GaugeExtra<{urlIndex: number}>;
};
