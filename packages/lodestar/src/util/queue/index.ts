import {AbortSignal} from "abort-controller";
import {sleep} from "@chainsafe/lodestar-utils";
import {wrapError} from "../wrapError";
import {QueueError, QueueErrorCode} from "./errors";
import {QueueMetricsOpts, IQueueMetrics, createQueueMetrics} from "./metrics";
export {QueueError, QueueErrorCode, QueueMetricsOpts};

export type JobQueueOpts = {
  maxLength: number;
  signal: AbortSignal;
  /** Defaults to FIFO */
  type?: QueueType;
};

export enum QueueType {
  FIFO = "FIFO",
  LIFO = "LIFO",
}

enum QueueState {
  Idle,
  Running,
  Yielding,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job<R> = (...args: any) => Promise<R>;

type JobQueueItem<R, Fn extends Job<R>> = {
  job: Fn;
  resolve: (result: R | PromiseLike<R>) => void;
  reject: (error?: Error) => void;
};

export class JobQueue {
  private state = QueueState.Idle;
  private readonly opts: JobQueueOpts;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly jobs: JobQueueItem<any, Job<any>>[] = [];
  private readonly metrics?: IQueueMetrics;

  constructor(opts: JobQueueOpts, metricsOpts?: QueueMetricsOpts) {
    this.opts = opts;
    this.opts.signal.addEventListener("abort", this.abortAllJobs, {once: true});
    this.metrics = metricsOpts && createQueueMetrics(metricsOpts, {getQueueLength: () => this.jobs.length});
  }

  async push<R, Fn extends Job<R> = Job<R>>(job: Fn): Promise<R> {
    if (this.opts.signal.aborted) {
      throw new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    }

    if (this.jobs.length + 1 > this.opts.maxLength) {
      this.metrics?.droppedJobs.inc();
      throw new QueueError({code: QueueErrorCode.QUEUE_MAX_LENGTH});
    }

    return await new Promise<R>((resolve, reject) => {
      this.jobs.push({job, resolve, reject});
      setTimeout(this.runJob, 0);
    });
  }

  private runJob = async (): Promise<void> => {
    if (this.opts.signal.aborted || this.state !== QueueState.Idle) {
      return;
    }

    // Default to FIFO. LIFO -> pop() remove last item, FIFO -> shift() remove first item
    const job = this.opts.type === QueueType.LIFO ? this.jobs.pop() : this.jobs.shift();
    if (!job) {
      return;
    }

    this.state = QueueState.Running;

    const timer = this.metrics?.jobTime.startTimer();

    const res = await wrapError<unknown>(job.job());
    if (res.err) job.reject(res.err);
    else job.resolve(res.result);

    if (timer) timer();

    // Yield to the macro queue
    this.state = QueueState.Yielding;
    await sleep(0);
    this.state = QueueState.Idle;

    // Potentially run a new job
    void this.runJob();
  };

  private abortAllJobs = (): void => {
    while (this.jobs.length > 0) {
      const job = this.jobs.pop();
      if (job) job.reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
    }
  };
}
