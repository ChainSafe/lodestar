export type Metrics = {
  requestTime: Histogram<"routeId">;
  streamTime: Histogram<"routeId">;
  requestErrors: Gauge<"routeId">;
  requestToFallbacks: Gauge<"routeId">;
  urlsScore: Gauge<"urlIndex">;
};

type LabelValues<T extends string> = Partial<Record<T, string | number>>;
type CollectFn<T extends string> = (metric: Gauge<T>) => void;

export interface Gauge<T extends string> {
  /**
   * Increment gauge for given labels
   * @param labels Object with label keys and values
   * @param value The value to increment with
   */
  inc(labels: LabelValues<T>, value?: number): void;

  /**
   * Increment gauge
   * @param value The value to increment with
   */
  inc(value?: number): void;

  /**
   * Set gauge value for labels
   * @param labels Object with label keys and values
   * @param value The value to set
   */
  set(labels: LabelValues<T>, value: number): void;

  /**
   * Set gauge value
   * @param value The value to set
   */
  set(value: number): void;

  addCollect(collectFn: CollectFn<T>): void;
}

export interface Histogram<T extends string> {
  /**
   * Start a timer where the value in seconds will observed
   * @param labels Object with label keys and values
   * @return Function to invoke when timer should be stopped
   */
  startTimer(labels?: LabelValues<T>): (labels?: LabelValues<T>) => number;
}
