import {Gauge, Histogram} from "prom-client";
import {IBeaconMetrics} from "../../metrics";

export type QueueMetricsOpts = {
  metrics: IBeaconMetrics | undefined;
  prefix: string;
};

export interface IQueueMetrics {
  length: Gauge<string>;
  droppedJobs: Gauge<string>;
  /**
   * Total number of seconds spent completing queue jobs
   * Useful to compute the utilitzation ratio of this queue with:
   * `rate(metrics_name[1m])`
   */
  jobTime: Histogram<string>;
}

export function createQueueMetrics(
  metricsOpts: QueueMetricsOpts,
  hooks: {getQueueLength: () => number}
): IQueueMetrics | undefined {
  const {metrics, prefix} = metricsOpts;
  if (!metrics) return;

  return {
    length: new Gauge({
      name: `${prefix}_length`,
      help: `Count of total queue length of ${prefix}`,
      registers: [metrics.registry],
      collect() {
        this.set(hooks.getQueueLength());
      },
    }),

    droppedJobs: new Gauge({
      name: `${prefix}_dropped_jobs_total`,
      help: `Count of total dropped jobs of ${prefix}`,
      registers: [metrics.registry],
    }),

    jobTime: new Histogram({
      name: `${prefix}_job_time_seconds`,
      help: `Time to process queue job of ${prefix} in seconds`,
      registers: [metrics.registry],
    }),
  };
}
