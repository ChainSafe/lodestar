import {IGauge, IHistogram, IQueueMetrics} from "@lodestar/utils/metrics";

export type IMetrics = {
  executionEnginerHttpClient: JsonRpcHttpClientMetrics;
  engineHttpProcessorQueue: IQueueMetrics;
};

export type JsonRpcHttpClientMetrics = {
  requestTime: IHistogram<"routeId">;
  requestErrors: IGauge<"routeId">;
  requestUsedFallbackUrl: IGauge<"routeId">;
  activeRequests: IGauge<"routeId">;
  configUrlsCount: IGauge;
  retryCount: IGauge<"routeId">;
};
