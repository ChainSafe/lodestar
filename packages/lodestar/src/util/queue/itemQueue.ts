import {sleep} from "@chainsafe/lodestar-utils";
import {QueueError, QueueErrorCode} from "./errors";
import {defaultQueueOpts, IQueueMetrics, JobQueueOpts, QueueType} from "./options";

export class JobItemQueue<T, R> {
  private readonly opts: Required<JobQueueOpts>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly jobs: {
    item: T;
    addedTimeMs: number;
    resolve: (result: R | PromiseLike<R>) => void;
    reject: (error?: Error) => void;
  }[] = [];
  private readonly metrics?: IQueueMetrics;
  private runningJobs = 0;
  private lastYield = 0;

  constructor(private readonly itemProcessor: (item: T) => Promise<R>, opts: JobQueueOpts, metrics?: IQueueMetrics) {
    this.opts = {...defaultQueueOpts, ...opts};
    this.opts.signal.addEventListener("abort", this.dropAllJobs, {once: true});

    if (metrics) {
      this.metrics = metrics;
      metrics.length.addCollect(() => metrics.length.set(this.jobs.length));
    }
  }

  push(item: T): Promise<R> {
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
      this.jobs.push({item, resolve, reject, addedTimeMs: Date.now()});
      setTimeout(this.runJob, 0);
    });
  }

  getItems(): {item: T; addedTimeMs: number}[] {
    return this.jobs.map((job) => ({item: job.item, addedTimeMs: job.addedTimeMs}));
  }

  dropAllJobs = (): void => {
    this.jobs.splice(0, this.jobs.length);
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

      const result = await this.itemProcessor(job.item);
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
}
