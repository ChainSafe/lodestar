import {IGauge, IHistogram} from "@lodestar/utils";

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

export interface IQueueMetrics {
  length: IGauge;
  droppedJobs: IGauge;
  /** Compute async utilization rate with `rate(metrics_name[1m])` */
  jobTime: IHistogram;
  jobWaitTime: IHistogram;
}
