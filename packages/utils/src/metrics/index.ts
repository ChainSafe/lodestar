import {Gauge, Histogram} from "prom-client";

export type IGauge<T extends string = string> = Pick<Gauge<T>, "inc" | "dec" | "set"> & {
  addCollect: (collectFn: () => void) => void;
};

export type IHistogram<T extends string = string> = Pick<Histogram<T>, "observe" | "startTimer">;

export type IAvgMinMax = {
  addGetValuesFn(getValuesFn: () => number[]): void;
  set(values: number[]): void;
};

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
