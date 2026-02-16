import {callInNextEventLoop, nextEventLoop} from "../../util/eventLoop.js";
import {LinkedList} from "../array.js";
import {QueueError, QueueErrorCode} from "./errors.js";
import {JobQueueOpts, QueueMetrics, QueueType, defaultQueueOpts} from "./options.js";

/**
 * JobQueue that stores arguments in the job array instead of closures.
 * Supports a single itemProcessor, for arbitrary functions use the JobFnQueue
 */

// biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
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
  /** Resolvers waiting for space in the queue */
  private spaceWaiters: (() => void)[] = [];

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

  get jobLen(): number {
    return this.jobs.length;
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
        callInNextEventLoop(this.runJob);
      }
    });
  }

  /**
   * Returns a promise that resolves when there is space in the queue.
   * If the queue already has space, resolves immediately (noop).
   * Use this to apply backpressure when the caller should wait rather than
   * have push() throw QUEUE_MAX_LENGTH.
   */
  async waitForSpace(): Promise<void> {
    if (this.opts.signal.aborted) {
      throw new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    }

    if (this.jobs.length < this.opts.maxLength) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        const index = this.spaceWaiters.indexOf(wrappedResolve);
        if (index >= 0) {
          this.spaceWaiters.splice(index, 1);
        }
        reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
      };

      const wrappedResolve = (): void => {
        if (settled) return;
        settled = true;
        this.opts.signal.removeEventListener("abort", onAbort);
        resolve();
      };

      this.spaceWaiters.push(wrappedResolve);
      this.opts.signal.addEventListener("abort", onAbort, {once: true});

      // Re-check after attaching listener to close the race window where
      // signal.abort() fires between the initial check and addEventListener
      if (this.opts.signal.aborted) onAbort();
    });
  }

  getItems(): {args: Args; addedTimeMs: number}[] {
    return this.jobs.map((job) => ({args: job.args, addedTimeMs: job.addedTimeMs}));
  }

  dropAllJobs = (): void => {
    this.jobs.clear();
    this.notifySpaceWaiters();
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
    // Only downside is the job promise may be resolved twice, but that's not an issue
    try {
      const timer = this.metrics?.jobTime.startTimer();
      this.metrics?.jobWaitTime.observe((Date.now() - job.addedTimeMs) / 1000);

      const result = await this.itemProcessor(...job.args);
      job.resolve(result);

      if (timer) timer();

      // Yield to the macro queue
      if (Date.now() - this.lastYield > this.opts.yieldEveryMs) {
        this.lastYield = Date.now();
        await nextEventLoop();
      }
    } catch (e) {
      job.reject(e as Error);
    }

    this.runningJobs = Math.max(0, this.runningJobs - 1);

    // Notify any waiters that space is available
    this.notifySpaceWaiters();

    // Potentially run a new job
    void this.runJob();
  };

  private notifySpaceWaiters(): void {
    // Compute available slots once to avoid thundering herd: resolved waiters
    // won't push() until the next microtask, so jobs.length doesn't change
    // inside this loop. Without the cap we'd wake ALL waiters on a single slot.
    let available = this.opts.maxLength - this.jobs.length;
    while (available > 0 && this.spaceWaiters.length > 0) {
      const resolve = this.spaceWaiters.shift();
      if (resolve) resolve();
      available--;
    }
  }

  private abortAllJobs = (): void => {
    while (this.jobs.length > 0) {
      const job = this.jobs.pop();
      if (job) job.reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
    }
  };
}
