/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import {LinkedList} from "../../../util/array.js";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {QueueError, QueueErrorCode} from "../../../util/queue/errors.js";

export type ItemOpts = {
  /**
   * A batchable set MAY be verified with more sets to reduce the verification costs.
   * Multiple sets may be merged and verified as one set. If the result is correct, success is returned
   * for all them. If at least one set is invalid, all sets are reverified individually. For normal network
   * conditions this strategy can yield 50% improvement in CPU time spent verifying gossip objects.
   * Only non-time critical objects should be marked as batchable, since the pool may hold them for 100ms.
   */
  batchable?: boolean;

  /**
   * Some items are more important than others and should be processed first.
   */
  priority?: boolean;
};

export type JobItem<Req, Res> = {
  opts: ItemOpts;
  addedTimeMs: number;
  resolve: (res: Res) => void;
  reject: (err?: Error) => void;
} & Req;

interface JobQueueInit<Req, Res> {
  itemWeight: (i: JobItem<Req, Res>) => number;
  executeJobs: (items: JobItem<Req, Res>[]) => void;
  maxWeightPerBatch: number;
  maxBufferWaitMs: number;
}

/**
 * A queue that batches jobs up to a certain weight
 *
 * It operates on Arrays of JobItems
 */
export class BufferedJobQueue<Req, Res> {
  private readonly jobs = new LinkedList<JobItem<Req, Res>>();

  private bufferedJobs: {
    jobs: LinkedList<JobItem<Req, Res>>;
    prioritizedJobs: LinkedList<JobItem<Req, Res>>;
    /* this is not necessarily the same as the length of the jobs list */
    weight: number;
    firstPush: number;
    timeout: NodeJS.Timeout;
  } | null = null;

  private init: JobQueueInit<Req, Res>;
  private closed = false;

  constructor(init: JobQueueInit<Req, Res>) {
    this.jobs = new LinkedList();
    this.init = init;
  }

  pendingJobs(): number {
    return this.jobs.length + (this.bufferedJobs?.jobs.length ?? 0);
  }

  close(): void {
    this.closed = true;
    if (this.bufferedJobs) {
      clearTimeout(this.bufferedJobs.timeout);
    }

    // Abort all jobs
    for (const job of this.jobs) {
      job.reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
    }
    this.jobs.clear();
  }

  /**
   * Execute the next jobs in the queue
   */
  execute = (): void => {
    if (this.closed) {
      return;
    }

    const jobs = this.prepareWork();
    if (jobs.length === 0) {
      return;
    }

    this.init.executeJobs(jobs);

    // Potentially run a new job
    callInNextEventLoop(this.execute);
  };

  /**
   * Register work to be done eventually
   */
  enqueueJob(job: JobItem<Req, Res>): void {
    if (this.closed) {
      throw new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    }

    // TODO: Consider if limiting queue size is necessary here.
    // It would be bad to reject signatures because the node is slow.
    // However, if the worker communication broke jobs won't ever finish

    // Append batchable sets to `bufferedJobs`, starting a timeout to push them into `jobs`.
    // Do not call `runJob()`, it is called from `runBufferedJobs()`
    if (job.opts.batchable) {
      if (!this.bufferedJobs) {
        this.bufferedJobs = {
          jobs: new LinkedList(),
          prioritizedJobs: new LinkedList(),
          weight: 0,
          firstPush: Date.now(),
          timeout: setTimeout(this.runBufferedJobs, this.init.maxBufferWaitMs),
        };
      }
      const jobs = job.opts.priority ? this.bufferedJobs.prioritizedJobs : this.bufferedJobs.jobs;
      jobs.push(job);
      this.bufferedJobs.weight += this.init.itemWeight(job);
      if (this.bufferedJobs.weight > this.init.maxWeightPerBatch) {
        clearTimeout(this.bufferedJobs.timeout);
        this.runBufferedJobs();
      }
    }

    // Push job and schedule to call `runJob` in the next macro event loop cycle.
    // This is useful to allow batching job submitted from a synchronous for loop,
    // and to prevent large stacks since runJob may be called recursively.
    else {
      if (job.opts.priority) {
        this.jobs.unshift(job);
      } else {
        this.jobs.push(job);
      }
      callInNextEventLoop(this.execute);
    }
  }

  /**
   * Grab pending jobs up to max weight
   */
  private prepareWork(): JobItem<Req, Res>[] {
    const jobs: JobItem<Req, Res>[] = [];
    let totalWeight = 0;

    while (totalWeight < this.init.maxWeightPerBatch) {
      const job = this.jobs.shift();
      if (!job) {
        break;
      }

      jobs.push(job);
      totalWeight += this.init.itemWeight(job);
    }

    return jobs;
  }

  private runBufferedJobs = (): void => {
    if (this.bufferedJobs) {
      for (const job of this.bufferedJobs.jobs) {
        this.jobs.push(job);
      }
      for (const job of this.bufferedJobs.prioritizedJobs) {
        this.jobs.unshift(job);
      }
      this.bufferedJobs = null;
      callInNextEventLoop(this.execute);
    }
  };
}
