type LabelValues<T extends string> = Partial<Record<T, string | number>>;

export type IGauge<T extends string = string> = Pick<Gauge<T>, "inc" | "dec" | "set"> & {
  addCollect: (collectFn: () => void) => void;
};

interface Gauge<T extends string = string> {
  // Sorry for this mess, `prom-client` API choices are not great
  // If the function signature was `inc(value: number, labels?: Labels)`, this would be simpler
  inc(value?: number): void;
  inc(labels: LabelValues<T>, value?: number): void;
  inc(arg1?: LabelValues<T> | number, arg2?: number): void;

  dec(value?: number): void;
  dec(labels: LabelValues<T>, value?: number): void;
  dec(arg1?: LabelValues<T> | number, arg2?: number): void;

  set(value: number): void;
  set(labels: LabelValues<T>, value: number): void;
  set(arg1?: LabelValues<T> | number, arg2?: number): void;

  addCollect: (collectFn: () => void) => void;
}

interface Histogram<T extends string = string> {
  startTimer(arg1?: LabelValues<T>): (labels?: LabelValues<T>) => number;

  observe(value: number): void;
  observe(labels: LabelValues<T>, values: number): void;
  observe(arg1: LabelValues<T> | number, arg2?: number): void;

  reset(): void;
}

export type IHistogram<T extends string = string> = Pick<Histogram<T>, "observe" | "startTimer">;

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
