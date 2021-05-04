import {AbortSignal} from "abort-controller";
import {sleep} from "@chainsafe/lodestar-utils";
import {QueueError, QueueErrorCode} from "./errors";
import {IGauge, IHistogram} from "../../metrics";
export {QueueError, QueueErrorCode};

export enum QueueType {
  FIFO = "FIFO",
  LIFO = "LIFO",
}

export type JobQueueOpts = {
  maxLength: number;
  /** Defaults to 1 */
  maxConcurrency?: number;
  /** Yield to the macro queue every at least every N miliseconds */
  yieldEveryMs?: number;
  signal: AbortSignal;
  /** Defaults to FIFO */
  type?: QueueType;
};

const defaultQueueOpts: Required<Pick<JobQueueOpts, "maxConcurrency" | "yieldEveryMs" | "type">> = {
  maxConcurrency: 1,
  yieldEveryMs: 50,
  type: QueueType.FIFO,
};

export interface IQueueMetrics {
  length: IGauge;
  droppedJobs: IGauge;
  /** Compute async utilization rate with `rate(metrics_name[1m])` */
  jobTime: IHistogram;
  jobWaitTime: IHistogram;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job<R> = (...args: any) => Promise<R>;

type JobQueueItem<R, Fn extends Job<R>> = {
  job: Fn;
  resolve: (result: R | PromiseLike<R>) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
};

export class JobQueue {
  private readonly opts: Required<JobQueueOpts>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly jobs: JobQueueItem<any, Job<unknown>>[] = [];
  private readonly metrics?: IQueueMetrics;
  private runningJobs = 0;
  private lastYield = 0;

  constructor(opts: JobQueueOpts, metrics?: IQueueMetrics) {
    this.opts = {...defaultQueueOpts, ...opts};
    this.opts.signal.addEventListener("abort", this.abortAllJobs, {once: true});

    if (metrics) {
      this.metrics = metrics;
      metrics.length.addCollect(() => metrics.length.set(this.jobs.length));
    }
  }

  async push<R, Fn extends Job<R> = Job<R>>(job: Fn): Promise<R> {
    if (this.opts.signal.aborted) {
      throw new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    }

    if (this.jobs.length + 1 > this.opts.maxLength) {
      this.metrics?.droppedJobs.inc();
      if (this.opts.type === QueueType.LIFO) {
        // In LIFO queues keep the latest job and drop the oldest
        this.jobs.shift();
      } else {
        // In FIFO queues drop the latest job
        throw new QueueError({code: QueueErrorCode.QUEUE_MAX_LENGTH});
      }
    }

    return await new Promise<R>((resolve, reject) => {
      this.jobs.push({job, resolve, reject, addedTimeMs: Date.now()});
      setTimeout(this.runJob, 0);
    });
  }

  private runJob = async (): Promise<void> => {
    if (this.opts.signal.aborted || this.runningJobs >= this.opts.maxConcurrency) {
      return;
    }

    // Default to FIFO. LIFO -> pop() remove last item, FIFO -> shift() remove first item
    const job = this.opts.type === QueueType.LIFO ? this.jobs.pop() : this.jobs.shift();
    if (!job) {
      return;
    }

    this.runningJobs++;

    // If the job, metrics or any code below throws: the job will reject never going stale.
    // Only downside is the the job promise may be resolved twice, but that's not an issue
    try {
      const timer = this.metrics?.jobTime.startTimer();
      this.metrics?.jobWaitTime.observe((Date.now() - job.addedTimeMs) / 1000);

      const result = await job.job();
      job.resolve(result);

      if (timer) timer();

      // Yield to the macro queue
      if (Date.now() - this.lastYield > this.opts.yieldEveryMs) {
        this.lastYield = Date.now();
        await sleep(0);
      }
    } catch (e) {
      job.reject(e);
    }

    this.runningJobs = Math.max(0, this.runningJobs - 1);

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
