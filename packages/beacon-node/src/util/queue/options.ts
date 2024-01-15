import {Gauge, GaugeExtra, Histogram} from "@lodestar/utils";

export enum QueueType {
  FIFO = "FIFO",
  LIFO = "LIFO",
}

export type JobQueueOpts = {
  maxLength: number;
  /** Defaults to 1 */
  maxConcurrency?: number;
  /** Yield to the macro queue every at least every N milliseconds */
  yieldEveryMs?: number;
  signal: AbortSignal;
  /** Defaults to FIFO */
  type?: QueueType;
  /**By default yield per push()*/
  noYieldIfOneItem?: boolean;
};

export type QueueMetrics = {
  length: GaugeExtra;
  droppedJobs: Gauge;
  /** Compute async utilization rate with `rate(metrics_name[1m])` */
  jobTime: Histogram;
  jobWaitTime: Histogram;
  concurrency: Gauge;
};

export const defaultQueueOpts: Required<
  Pick<JobQueueOpts, "maxConcurrency" | "yieldEveryMs" | "type" | "noYieldIfOneItem">
> = {
  maxConcurrency: 1,
  yieldEveryMs: 50,
  type: QueueType.FIFO,
  noYieldIfOneItem: false,
};
