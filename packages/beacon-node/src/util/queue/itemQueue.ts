import {sleep} from "@lodestar/utils";
import {LinkedList} from "../array.js";
import {QueueError, QueueErrorCode} from "./errors.js";
import {defaultQueueOpts, QueueMetrics, JobQueueOpts, QueueType} from "./options.js";

/**
 * JobQueue that stores arguments in the job array instead of closures.
 * Supports a single itemProcessor, for arbitrary functions use the JobFnQueue
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class JobItemQueue<Args extends any[], R> {
  private readonly opts: Required<JobQueueOpts>;
  /**
   * We choose to use LinkedList instead of regular array to improve shift() / push() / pop() performance.
   * See the LinkedList benchmark for more details.
   * */
  private readonly jobs: LinkedList<{
    args: Args;
    addedTimeMs: number;
    resolve: (result: R | PromiseLike<R>) => void;
    reject: (error?: Error) => void;
  }> = new LinkedList();
  private readonly metrics?: QueueMetrics;
  private runningJobs = 0;
  private lastYield = 0;

  constructor(
    private readonly itemProcessor: (...args: Args) => Promise<R>,
    opts: JobQueueOpts,
    metrics?: QueueMetrics
  ) {
    this.opts = {...defaultQueueOpts, ...opts};
    this.opts.signal.addEventListener("abort", this.abortAllJobs, {once: true});

    if (metrics) {
      this.metrics = metrics;
      metrics.length.addCollect(() => {
        metrics.length.set(this.jobs.length);
        metrics.concurrency.set(this.runningJobs);
      });
    }
  }

  push(...args: Args): Promise<R> {
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

    return new Promise<R>((resolve, reject) => {
      this.jobs.push({args, resolve, reject, addedTimeMs: Date.now()});
      if (this.jobs.length === 1 && this.opts.noYieldIfOneItem) {
        void this.runJob();
      } else if (this.runningJobs < this.opts.maxConcurrency) {
        setTimeout(this.runJob, 0);
      }
    });
  }

  getItems(): {args: Args; addedTimeMs: number}[] {
    return this.jobs.map((job) => ({args: job.args, addedTimeMs: job.addedTimeMs}));
  }

  dropAllJobs = (): void => {
    this.jobs.clear();
  };

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

      const result = await this.itemProcessor(...job.args);
      job.resolve(result);

      if (timer) timer();

      // Yield to the macro queue
      if (Date.now() - this.lastYield > this.opts.yieldEveryMs) {
        this.lastYield = Date.now();
        await sleep(0);
      }
    } catch (e) {
      job.reject(e as Error);
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
