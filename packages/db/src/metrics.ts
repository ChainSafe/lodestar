export type DbMetricLabels = "bucket";

export interface IDbMetrics {
  dbReads: DbMetricCounter;
  dbWrites: DbMetricCounter;
}

export type DbMetricCounter = ICounter<DbMetricLabels>;

export interface ICounter<T extends string> {
  labels(labels: Partial<Record<T, string | number>>): {inc(value?: number): void};
}
