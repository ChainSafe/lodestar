import {
  BLS_VERIFIER_EXECUTOR_CONCURRENCY,
  verifySignatureSetsAsync,
  verifySignatureSetsSameMessageAsync,
} from "@chainsafe/lodestar-z/bls-verifier";
import {ISignatureSet} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../../metrics/index.js";
import {LinkedList} from "../../../util/array.js";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {QueueError, QueueErrorCode} from "../../../util/queue/index.js";
import {IBlsVerifier, SameMessageSignatureSet, VerifySignatureOpts} from "../interface.js";
import {chunkSameMessageSignatureSets, getAggregatedPubkeysCount} from "../utils.js";
import {JobQueueItem, jobItemSigSets, jobItemWorkReq} from "./jobItem.js";
import {NativeBlsScheduler} from "./nativeScheduler.js";
import {BlsWorkReq, BlsWorkResult, JobQueueItemType, WorkResultCode, WorkResultError} from "./types.js";
import {chunkifyMaximizeChunkSize} from "./utils.js";
import {NativeBlsVerifier, verifyManySignatureSets} from "./verifyMany.js";

export type BlsMultiThreadVerifierModules = {
  logger: Logger;
  metrics: Metrics | null;
};

export type BlsMultiThreadVerifierOptions = {
  /** @deprecated Native BLS verification is always asynchronous. */
  blsVerifyAllMultiThread?: boolean;
};

export type {JobQueueItemType};

/**
 * Split large requests so each native root has a bounded snapshot and fallback
 * cost. Sync batches can contain thousands of signature sets.
 */
const MAX_SIGNATURE_SETS_PER_JOB = 128;

/**
 * Batch low-priority gossip work across requests. Verification above roughly
 * 32 sets has diminishing pairing savings and a larger invalid-batch retry.
 */
const MAX_BUFFERED_SIGS = 32;
const MAX_BUFFER_WAIT_MS = 100;

/**
 * Bound normal request admission. Critical requests are trusted internal work
 * and bypass this limit, while still sharing the bounded native queue.
 */
const MAX_OUTSTANDING_JOBS = 512;

/**
 * Batches semantic signature requests on the JavaScript event loop and sends
 * bounded, priority-aware roots to the process-wide native BLS executor.
 */
export class BlsMultiThreadVerifier implements IBlsVerifier {
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;

  private readonly jobs = new LinkedList<JobQueueItem>();
  private readonly prioritizedJobs = new LinkedList<JobQueueItem>();
  private readonly runningJobs = new Set<JobQueueItem>();
  private bufferedJobs: {
    jobs: LinkedList<JobQueueItem>;
    sigCount: number;
    timeout: NodeJS.Timeout;
  } | null = null;
  private outstandingJobs = 0;
  private closed = false;
  private readonly nativeScheduler: NativeBlsScheduler;
  private readonly nativeVerifier: NativeBlsVerifier;

  constructor(_options: BlsMultiThreadVerifierOptions, modules: BlsMultiThreadVerifierModules) {
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.nativeScheduler = new NativeBlsScheduler(
      BLS_VERIFIER_EXECUTOR_CONCURRENCY,
      (sigCount, duration, queueWait) => {
        this.metrics?.blsThreadPool.jobsWorkerTime.inc({workerId: 0}, duration);
        if (sigCount > 0) this.metrics?.blsThreadPool.timePerSigSet.observe(duration / sigCount);
        this.metrics?.blsThreadPool.latencyToWorker.observe(queueWait);
      }
    );
    this.nativeVerifier = {
      verify: (sets, critical) =>
        this.nativeScheduler.schedule(critical, sets.length, () => verifySignatureSetsAsync(sets, critical)),
      verifySameMessage: (sets, message, critical) =>
        this.nativeScheduler.schedule(critical, sets.length, () =>
          verifySignatureSetsSameMessageAsync(sets, message, critical)
        ),
    };

    modules.metrics?.blsThreadPool.queueLength.addCollect(() => {
      const queuedJobs =
        this.jobs.length +
        this.prioritizedJobs.length +
        (this.bufferedJobs?.jobs.length ?? 0) +
        this.nativeScheduler.queuedJobs;
      modules.metrics?.blsThreadPool.queueLength.set(queuedJobs);
      modules.metrics?.blsThreadPool.workersBusy.set(this.nativeScheduler.occupiedSlots);
    });
  }

  canAcceptWork(): boolean {
    return !this.closed && this.outstandingJobs < MAX_OUTSTANDING_JOBS && this.nativeScheduler.canAcceptNormalWork;
  }

  async verifySignatureSets(sets: ISignatureSet[], opts: VerifySignatureOpts = {}): Promise<boolean> {
    this.metrics?.bls.aggregatedPubkeys.inc(getAggregatedPubkeysCount(sets));
    this.metrics?.blsThreadPool.totalSigSets.inc(sets.length);
    if (opts.priority || opts.verifyOnMainThread) {
      this.metrics?.blsThreadPool.prioritizedSigSets.inc(sets.length);
    }
    if (opts.batchable && !opts.verifyOnMainThread) {
      this.metrics?.blsThreadPool.batchableSigSets.inc(sets.length);
    }

    if (sets.length === 0) return false;

    // `verifyOnMainThread` was the old low-latency path. Preserve its intent,
    // without blocking the event loop, by treating it as unbatched critical work.
    const effectiveOpts = opts.verifyOnMainThread ? {...opts, batchable: false, priority: true} : opts;
    const results = await Promise.all(
      chunkifyMaximizeChunkSize(sets, MAX_SIGNATURE_SETS_PER_JOB).map((setsChunk) => {
        this.outstandingJobs++;
        return new Promise<boolean>((resolve, reject) => {
          this.queueBlsWork({
            type: JobQueueItemType.default,
            resolve,
            reject,
            addedTimeMs: Date.now(),
            opts: effectiveOpts,
            sets: setsChunk,
          });
        }).finally(() => {
          this.outstandingJobs--;
        });
      })
    );

    return results.every((isValid) => isValid);
  }

  async verifySignatureSetsSameMessage(
    sets: SameMessageSignatureSet[],
    message: Uint8Array,
    opts: Omit<VerifySignatureOpts, "verifyOnMainThread"> = {}
  ): Promise<boolean[]> {
    const promises: Promise<boolean[]>[] = [];
    for (const setsChunk of chunkSameMessageSignatureSets(sets)) {
      this.outstandingJobs++;
      promises.push(
        new Promise<boolean[]>((resolve, reject) => {
          this.queueBlsWork({
            type: JobQueueItemType.sameMessage,
            resolve,
            reject,
            addedTimeMs: Date.now(),
            opts,
            sets: setsChunk,
            message,
          });
        }).finally(() => {
          this.outstandingJobs--;
        })
      );
    }

    return (await Promise.all(promises)).flat();
  }

  async close(): Promise<void> {
    if (this.closed) return this.nativeScheduler.close(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
    this.closed = true;

    const error = new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    if (this.bufferedJobs) {
      clearTimeout(this.bufferedJobs.timeout);
      rejectJobs(this.bufferedJobs.jobs, error);
      this.bufferedJobs = null;
    }
    rejectJobs(this.prioritizedJobs, error);
    rejectJobs(this.jobs, error);
    for (const job of this.runningJobs) job.reject(error);
    return this.nativeScheduler.close(error);
  }

  private queueBlsWork(job: JobQueueItem): void {
    if (this.closed) {
      job.reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
      return;
    }
    if (!job.opts.priority && this.outstandingJobs > MAX_OUTSTANDING_JOBS) {
      job.reject(new QueueError({code: QueueErrorCode.QUEUE_MAX_LENGTH}));
      return;
    }

    if (job.opts.batchable && !job.opts.priority) {
      if (!this.bufferedJobs) {
        this.bufferedJobs = {
          jobs: new LinkedList(),
          sigCount: 0,
          timeout: setTimeout(this.runBufferedJobs, MAX_BUFFER_WAIT_MS),
        };
      }
      this.bufferedJobs.jobs.push(job);
      this.bufferedJobs.sigCount += jobItemSigSets(job);
      if (this.bufferedJobs.sigCount > MAX_BUFFERED_SIGS) {
        clearTimeout(this.bufferedJobs.timeout);
        this.runBufferedJobs();
      }
      return;
    }

    (job.opts.priority ? this.prioritizedJobs : this.jobs).push(job);
    callInNextEventLoop(this.runJob);
  }

  private runJob = async (): Promise<void> => {
    if (this.closed) return;

    const jobsInput = this.prepareWork();
    if (jobsInput.length === 0) return;

    for (const job of jobsInput) this.runningJobs.add(job);
    // Continue draining request work while this group waits in the bounded
    // native queue. The native scheduler owns CPU concurrency and priority.
    callInNextEventLoop(this.runJob);

    let startedJobsDefault = 0;
    let startedJobsSameMessage = 0;
    let startedSetsDefault = 0;
    let startedSetsSameMessage = 0;
    const workReqs: BlsWorkReq[] = [];
    const jobsStarted: JobQueueItem[] = [];

    try {
      for (const job of jobsInput) {
        this.metrics?.blsThreadPool.jobWaitTime.observe((Date.now() - job.addedTimeMs) / 1000);

        try {
          workReqs.push(jobItemWorkReq(job));
          jobsStarted.push(job);
        } catch (e) {
          this.metrics?.blsThreadPool.errorJobsSignatureSetsCount.inc(jobItemSigSets(job));
          job.reject(asError(e));
          continue;
        }

        if (job.type === JobQueueItemType.sameMessage) {
          startedJobsSameMessage++;
          startedSetsSameMessage += job.sets.length;
        } else {
          startedJobsDefault++;
          startedSetsDefault += job.sets.length;
        }
      }

      if (workReqs.length === 0) return;

      this.metrics?.blsThreadPool.totalJobsGroupsStarted.inc();
      this.metrics?.blsThreadPool.totalJobsStarted.inc({type: JobQueueItemType.default}, startedJobsDefault);
      this.metrics?.blsThreadPool.totalJobsStarted.inc({type: JobQueueItemType.sameMessage}, startedJobsSameMessage);
      this.metrics?.blsThreadPool.totalSigSetsStarted.inc({type: JobQueueItemType.default}, startedSetsDefault);
      this.metrics?.blsThreadPool.totalSigSetsStarted.inc({type: JobQueueItemType.sameMessage}, startedSetsSameMessage);

      const workResult = await verifyManySignatureSets(workReqs, this.nativeVerifier);
      if (this.closed) return;

      this.resolveWork(jobsStarted, workResult);

      this.metrics?.blsThreadPool.batchRetries.inc(workResult.batchRetries);
      this.metrics?.blsThreadPool.batchSigsSuccess.inc(workResult.batchSigsSuccess);
    } catch (e) {
      const error = asError(e);
      if (!this.closed) {
        this.logger.error("BLS native scheduler error", {code: "BLS_NATIVE_SCHEDULER_ERROR"}, error);
      }
      for (const job of jobsStarted) job.reject(error);
    } finally {
      for (const job of jobsInput) this.runningJobs.delete(job);
      callInNextEventLoop(this.runJob);
    }
  };

  private resolveWork(jobs: JobQueueItem[], workResult: BlsWorkResult): void {
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const jobResult = workResult.results[i];
      const sigSetCount = jobItemSigSets(job);

      switch (job.type) {
        case JobQueueItemType.default:
          if (!jobResult || jobResult.code !== WorkResultCode.success) {
            job.reject(getJobResultError(jobResult, i));
            errorCount += sigSetCount;
          } else if (jobResult.result.length !== 1 || jobResult.result[0] === undefined) {
            job.reject(getInvalidResultLengthError(i, 1, jobResult.result.length));
            errorCount += sigSetCount;
          } else {
            job.resolve(jobResult.result[0]);
            successCount += sigSetCount;
          }
          break;

        case JobQueueItemType.sameMessage:
          if (!jobResult || jobResult.code !== WorkResultCode.success) {
            job.reject(getJobResultError(jobResult, i));
            errorCount += sigSetCount;
          } else if (jobResult.result.length !== sigSetCount) {
            job.reject(getInvalidResultLengthError(i, sigSetCount, jobResult.result.length));
            errorCount += sigSetCount;
          } else {
            job.resolve(jobResult.result);
            successCount += sigSetCount;
          }
          break;
      }
    }

    this.metrics?.blsThreadPool.successJobsSignatureSetsCount.inc(successCount);
    this.metrics?.blsThreadPool.errorJobsSignatureSetsCount.inc(errorCount);
  }

  private prepareWork(): JobQueueItem[] {
    const jobs: JobQueueItem[] = [];
    let totalSigs = 0;

    while (totalSigs < MAX_SIGNATURE_SETS_PER_JOB) {
      const job = this.prioritizedJobs.shift() ?? this.jobs.shift();
      if (!job) break;
      jobs.push(job);
      totalSigs += jobItemSigSets(job);
    }

    return jobs;
  }

  private runBufferedJobs = (): void => {
    if (!this.bufferedJobs) return;

    for (const job of this.bufferedJobs.jobs) this.jobs.push(job);
    this.bufferedJobs = null;
    callInNextEventLoop(this.runJob);
  };
}

/** @deprecated Use `BlsMultiThreadVerifier`. */
export {BlsMultiThreadVerifier as BlsMultiThreadWorkerPool};
/** @deprecated Use `BlsMultiThreadVerifierModules`. */
export type BlsMultiThreadWorkerPoolModules = BlsMultiThreadVerifierModules;
/** @deprecated Use `BlsMultiThreadVerifierOptions`. */
export type BlsMultiThreadWorkerPoolOptions = BlsMultiThreadVerifierOptions;

function rejectJobs(jobs: LinkedList<JobQueueItem>, error: Error): void {
  for (const job of jobs) job.reject(error);
  jobs.clear();
}

function getJobResultError(jobResult: WorkResultError | undefined, index: number): Error {
  const resultError = jobResult ? Error(jobResult.error.message) : Error(`No BLS result for index ${index}`);
  if (jobResult?.error.stack) resultError.stack = jobResult.error.stack;
  return resultError;
}

function getInvalidResultLengthError(index: number, expected: number, actual: number): Error {
  return Error(`Invalid BLS result length for index ${index}: expected ${expected}, got ${actual}`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : Error(String(error));
}
