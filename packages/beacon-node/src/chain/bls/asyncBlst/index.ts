/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import {PublicKey, Signature, verifyMultipleSignaturesSameMessage} from "@chainsafe/blst";
import {Logger} from "@lodestar/utils";
import {ISignatureSet} from "@lodestar/state-transition";
import {Metrics} from "../../../metrics/index.js";
import {IBlsVerifier, VerifySignatureOpts} from "../interface.js";
import {getAggregatedPubkey, getAggregatedPubkeysCount} from "../utils.js";
import {chunkifyMaximizeChunkSize} from "../multithread/utils.js";
import {defaultPoolSize} from "../multithread/poolSize.js";
import {BlsWorkReq, BlsWorkResult, SignatureSet, WorkResult, WorkResultCode, WorkResultError} from "./types.js";
import {verifySignatureSetsMaybeBatch} from "./verifySignatures.js";
import {BufferedJobQueue, JobItem} from "./jobQueue.js";

export enum JobQueueItemType {
  default = "default",
  sameMessage = "same_message",
}

export type BlsMultiThreadWorkerPoolModules = {
  logger: Logger;
  metrics: Metrics | null;
};

/**
 * Split big signature sets into smaller sets so they can be sent to multiple workers.
 *
 * The biggest sets happen during sync, on mainnet batches of 64 blocks have around ~8000 signatures.
 * The latency cost of sending the job to and from the worker is approx a single sig verification.
 * If you split a big signature into 2, the extra time cost is `(2+2N)/(1+2N)`.
 * For 128, the extra time cost is about 0.3%. No specific reasoning for `128`, it's just good enough.
 */
const MAX_SIGNATURE_SETS_PER_JOB = 128;

/**
 * Limit the number of same message signature sets that can be batched together.
 * The real savings is within a single message, so it's better to keep this number low.
 */
const MAX_SAME_MSG_SETS_PER_JOB = 8;

/**
 * If there are more than `MAX_BUFFERED_SIGS` buffered sigs, verify them immediately without waiting `MAX_BUFFER_WAIT_MS`.
 *
 * The efficiency improvement of batching sets asymptotically reaches x2. However, for batching large sets
 * has more risk in case a signature is invalid, requiring to revalidate all sets in the batch. 32 is sweet
 * point for this tradeoff.
 */
const MAX_BUFFERED_SIGS = 32;
/**
 * Gossip objects usually come in bursts. Buffering them for a short period of time allows to increase batching
 * efficiency, at the cost of delaying validation. Unless running in production shows otherwise, it's not critical
 * to hold attestations and aggregates for 100ms. Lodestar existing queues may hold those objects for much more anyway.
 *
 * There's no exact reasoning for the `100` milliseconds number. The metric `batchSigsSuccess` should indicate if this
 * value needs revision
 */
const MAX_BUFFER_WAIT_MS = 100;

/**
 * Max concurrent jobs on `canAcceptWork` status
 */
const MAX_JOBS_CAN_ACCEPT_WORK = 512;

/**
 * Split batchable sets in chunks of minimum size 16.
 * Batch verify 16 has an aprox cost of 16+1. For 32 it's 32+1. After ~16 the additional savings are not significant.
 * However, if a sig is invalid the whole batch has to be re-verified. So it's important to keep this number low.
 * In normal network conditions almost all signatures received by the node are correct.
 * After observing metrics this number can be reviewed
 */
const BATCHABLE_MIN_PER_CHUNK = 16;

type DefaultReq = {
  sets: ISignatureSet[];
};
type DefaultRes = boolean;

type SameMsgReq = {
  pks: PublicKey[];
  sigs: Signature[];
  msg: Uint8Array;
};
type SameMsgRes = boolean[];

/**
 */
export class BlsAsyncBlstVerifier implements IBlsVerifier {
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly poolSize = defaultPoolSize;
  private workerId = 0;

  private readonly defaultJobs: BufferedJobQueue<DefaultReq, DefaultRes>;
  private readonly sameMsgJobs: BufferedJobQueue<SameMsgReq, SameMsgRes>;

  private closed = false;
  private workersBusy = 0;

  constructor(modules: BlsMultiThreadWorkerPoolModules) {
    const {logger, metrics} = modules;
    this.logger = logger;
    this.metrics = metrics;

    this.defaultJobs = new BufferedJobQueue({
      itemWeight: (i) => i.sets.length,
      executeJobs: this.executeDefaultJobs,
      maxWeightPerBatch: MAX_SIGNATURE_SETS_PER_JOB,
      maxBufferWaitMs: MAX_BUFFER_WAIT_MS,
      maxBufferWeight: MAX_BUFFERED_SIGS,
    });
    this.sameMsgJobs = new BufferedJobQueue({
      itemWeight: () => 1,
      executeJobs: this.executeSameMsgJobs,
      maxWeightPerBatch: MAX_SAME_MSG_SETS_PER_JOB,
      maxBufferWaitMs: MAX_BUFFER_WAIT_MS,
      maxBufferWeight: MAX_SAME_MSG_SETS_PER_JOB,
    });

    if (metrics) {
      metrics.blsThreadPool.queueLength.addCollect(() => {
        metrics.blsThreadPool.queueLength.set(this.defaultJobs.pendingJobs() + this.sameMsgJobs.pendingJobs());
        metrics.blsThreadPool.workersBusy.set(this.workersBusy);
      });
    }
  }

  canAcceptWork(): boolean {
    return (
      this.workersBusy < this.poolSize &&
      // TODO: Should also bound the jobs queue?
      this.defaultJobs.pendingJobs() + this.sameMsgJobs.pendingJobs() < MAX_JOBS_CAN_ACCEPT_WORK
    );
  }

  async verifySignatureSets(sets: ISignatureSet[], opts: VerifySignatureOpts = {}): Promise<boolean> {
    // Pubkeys are aggregated in the main thread regardless if verified in workers or in main thread
    this.metrics?.bls.aggregatedPubkeys.inc(getAggregatedPubkeysCount(sets));
    this.metrics?.blsThreadPool.totalSigSets.inc(sets.length);
    if (opts.priority) {
      this.metrics?.blsThreadPool.prioritizedSigSets.inc(sets.length);
    }
    if (opts.batchable) {
      this.metrics?.blsThreadPool.batchableSigSets.inc(sets.length);
    }

    if (opts.verifyOnMainThread) {
      const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();
      try {
        return await verifySignatureSetsMaybeBatch(
          sets.map((set) => ({
            publicKey: getAggregatedPubkey(set, this.metrics),
            message: set.signingRoot.valueOf(),
            signature: Signature.fromBytes(set.signature, true),
          }))
        );
      } finally {
        if (timer) timer();
      }
    }

    // Split large array of sets into smaller.
    // Very helpful when syncing finalized, sync may submit +1000 sets so chunkify allows to distribute to many workers
    const results = await Promise.all(
      chunkifyMaximizeChunkSize(sets, MAX_SIGNATURE_SETS_PER_JOB).map(
        (setsChunk) =>
          new Promise<boolean>((resolve, reject) => {
            return this.defaultJobs.enqueueJob({
              resolve,
              reject,
              addedTimeMs: Date.now(),
              opts,
              sets: setsChunk,
            });
          })
      )
    );

    // .every on an empty array returns true
    if (results.length === 0) {
      throw Error("Empty results array");
    }

    return results.every((isValid) => isValid === true);
  }

  /**
   * Verify signature sets of the same message, only supports worker verification.
   */
  async verifySignatureSetsSameMessage(
    sets: {publicKey: PublicKey; signature: Uint8Array}[],
    msg: Uint8Array,
    opts: Omit<VerifySignatureOpts, "verifyOnMainThread"> = {}
  ): Promise<boolean[]> {
    const results = await new Promise<boolean[]>((resolve, reject) => {
      const pks = sets.map((set) => set.publicKey);
      // validate signature = true, this is slow code on main thread so should only run with network thread mode (useWorker=true)
      // For a node subscribing to all subnets, with 1 signature per validator per epoch it takes around 80s
      // to deserialize 750_000 signatures per epoch
      // cpu profile on main thread has 250s idle so this only works until we reach 3M validators
      // However, for normal node with only 2 to 7 subnet subscriptions per epoch this works until 27M validators
      // and not a problem in the near future
      // this is monitored on v1.11.0 https://github.com/ChainSafe/lodestar/pull/5912#issuecomment-1700320307
      const timer = this.metrics?.blsThreadPool.signatureDeserializationMainThreadDuration.startTimer();
      const sigs = sets.map((set) => Signature.fromBytes(set.signature, true));
      timer?.();
      this.sameMsgJobs.enqueueJob({
        resolve,
        reject,
        addedTimeMs: Date.now(),
        opts,
        msg,
        pks,
        sigs,
      });
    });

    return results;
  }

  async close(): Promise<void> {
    this.defaultJobs.close();
    this.sameMsgJobs.close();
  }

  /**
   * batch verify jobs
   */
  private executeDefaultJobs = async (jobs: JobItem<DefaultReq, DefaultRes>[]): Promise<void> => {
    if (jobs.length === 0) {
      return;
    }

    this.workersBusy++;

    try {
      let startedJobsDefault = 0;
      let startedSetsDefault = 0;
      const workReqs: BlsWorkReq[] = [];
      const jobsStarted: JobItem<DefaultReq, DefaultRes>[] = [];

      for (const job of jobs) {
        this.metrics?.blsThreadPool.jobWaitTime.observe((Date.now() - job.addedTimeMs) / 1000);

        let workReq: BlsWorkReq;
        try {
          // Note: This can throw, must be handled per-job.
          // Pubkey aggregation is deferred here
          workReq = {
            opts: job.opts,
            sets: job.sets.map((set) => ({
              // this can throw, handled in the consumer code
              publicKey: getAggregatedPubkey(set, this.metrics),
              signature: Signature.fromBytes(set.signature, true),
              message: set.signingRoot,
            })),
          };
        } catch (e) {
          this.metrics?.blsThreadPool.errorAggregateSignatureSetsCount.inc({type: JobQueueItemType.default});
          job.reject(e as Error);
          continue;
        }
        // Re-push all jobs with matching workReq for easier accounting of results
        workReqs.push(workReq);
        jobsStarted.push(job);

        startedJobsDefault += 1;
        startedSetsDefault += job.sets.length;
      }

      this.metricsAddJobsStarted(JobQueueItemType.default, startedJobsDefault, startedSetsDefault);

      // Send work package to the worker
      // If the job, metrics or any code below throws: the job will reject never going stale.
      // Only downside is the job promise may be resolved twice, but that's not an issue

      const [jobStartSec, jobStartNs] = process.hrtime();
      const workResult = await verifyManySignatureSets(workReqs);
      const [jobEndSec, jobEndNs] = process.hrtime();
      const {batchRetries, batchSigsSuccess, workerStartTime, workerEndTime, results} = workResult;

      const [workerStartSec, workerStartNs] = workerStartTime;
      const [workerEndSec, workerEndNs] = workerEndTime;

      let successCount = 0;
      let errorCount = 0;

      // Un-wrap work package
      for (let i = 0; i < jobsStarted.length; i++) {
        const job = jobsStarted[i];
        const jobResult = results[i];
        const sigSetCount = job.sets.length;

        if (!jobResult || jobResult.code !== WorkResultCode.success) {
          job.reject(getJobResultError(jobResult, i));
          errorCount += sigSetCount;
        } else {
          job.resolve(jobResult.result);
          successCount += sigSetCount;
        }
      }

      const workerId = this.workerId++ % this.poolSize;
      const workerJobTimeSec = workerEndSec - workerStartSec + (workerEndNs - workerStartNs) / 1e9;
      const latencyToWorkerSec = workerStartSec - jobStartSec + (workerStartNs - jobStartNs) / 1e9;
      const latencyFromWorkerSec = jobEndSec - workerEndSec + Number(jobEndNs - workerEndNs) / 1e9;

      this.metricsAddJobsFinished(
        JobQueueItemType.default,
        startedSetsDefault,
        successCount,
        errorCount,
        batchRetries,
        batchSigsSuccess,
        workerId,
        workerJobTimeSec,
        latencyToWorkerSec,
        latencyFromWorkerSec
      );
    } catch (e) {
      // Worker communications should never reject
      if (!this.closed) {
        this.logger.error("BlsMultiThreadWorkerPool error", {}, e as Error);
      }
      // Reject all
      for (const job of jobs) {
        job.reject(e as Error);
      }
    }

    this.workersBusy--;
  };

  /**
   * Potentially submit jobs to an idle worker, only if there's a worker and jobs
   */
  private executeSameMsgJobs = async (jobs: JobItem<SameMsgReq, SameMsgRes>[]): Promise<void> => {
    if (jobs.length === 0) {
      return;
    }

    this.workersBusy++;

    try {
      let startedJobsSameMessage = 0;
      let startedSetsSameMessage = 0;

      for (const job of jobs) {
        this.metrics?.blsThreadPool.jobWaitTime.observe((Date.now() - job.addedTimeMs) / 1000);
        startedJobsSameMessage += 1;
        startedSetsSameMessage += job.sigs.length;
      }

      this.metricsAddJobsStarted(JobQueueItemType.sameMessage, startedJobsSameMessage, startedSetsSameMessage);

      // Send work package to the worker
      // If the job, metrics or any code below throws: the job will reject never going stale.
      // Only downside is the job promise may be resolved twice, but that's not an issue

      const [jobStartSec, jobStartNs] = process.hrtime();
      const results = await verifyMultipleSignaturesSameMessages(jobs);
      const [jobEndSec, jobEndNs] = process.hrtime();

      let batchRetries = 0;
      const batchSigsSuccess = startedSetsSameMessage;
      let successCount = 0;
      const errorCount = 0;

      // Un-wrap work package
      for (let i = 0; i < jobs.length; i++) {
        if (!results[i]) {
          batchRetries++;
          if (jobs[i].sigs.length > 1) {
            const [j0, j1] = splitSameMsgJob(jobs[i]);
            this.sameMsgJobs.enqueueJob(j0);
            this.sameMsgJobs.enqueueJob(j1);
          } else {
            jobs[i].resolve([true]);
          }
        } else {
          jobs[i].resolve(Array.from({length: jobs[i].sigs.length}, () => true));
          successCount += 1;
        }
      }

      const workerId = this.workerId++ % this.poolSize;
      const workerJobTimeSec = jobEndSec - jobStartSec + (jobEndNs - jobStartNs) / 1e9;
      const latencyToWorkerSec = 0;
      const latencyFromWorkerSec = 0;

      this.metricsAddJobsFinished(
        JobQueueItemType.sameMessage,
        startedSetsSameMessage,
        successCount,
        errorCount,
        batchRetries,
        batchSigsSuccess,
        workerId,
        workerJobTimeSec,
        latencyToWorkerSec,
        latencyFromWorkerSec
      );
    } catch (e) {
      // Worker communications should never reject
      if (!this.closed) {
        this.logger.error("BlsMultiThreadWorkerPool error", {}, e as Error);
      }
      // Reject all
      for (const job of jobs) {
        job.reject(e as Error);
      }
    }

    this.workersBusy--;
  };

  private metricsAddJobsStarted(type: JobQueueItemType, jobsCount: number, setsCount: number): void {
    this.metrics?.blsThreadPool.totalJobsGroupsStarted.inc(1);
    this.metrics?.blsThreadPool.totalJobsStarted.inc({type}, jobsCount);
    this.metrics?.blsThreadPool.totalSigSetsStarted.inc({type}, setsCount);
  }

  private metricsAddJobsFinished(
    type: JobQueueItemType,
    startedSets: number,
    successCount: number,
    errorCount: number,
    batchRetries: number,
    batchSigsSuccess: number,
    workerId: number,
    workerJobTimeSec: number,
    latencyToWorkerSec: number,
    latencyFromWorkerSec: number
  ): void {
    this.metrics?.blsThreadPool.timePerSigSet.observe(workerJobTimeSec / startedSets);
    this.metrics?.blsThreadPool.jobsWorkerTime.inc({workerId}, workerJobTimeSec);
    this.metrics?.blsThreadPool.latencyToWorker.observe(latencyToWorkerSec);
    this.metrics?.blsThreadPool.latencyFromWorker.observe(latencyFromWorkerSec);
    this.metrics?.blsThreadPool.successJobsSignatureSetsCount.inc(successCount);
    this.metrics?.blsThreadPool.errorJobsSignatureSetsCount.inc(errorCount);
    this.metrics?.blsThreadPool.batchRetries.inc(batchRetries);
    this.metrics?.blsThreadPool.batchSigsSuccess.inc(batchSigsSuccess);
  }
}

function splitSameMsgJob(
  job: JobItem<SameMsgReq, SameMsgRes>
): [JobItem<SameMsgReq, SameMsgRes>, JobItem<SameMsgReq, SameMsgRes>] {
  const half = Math.floor(job.sigs.length / 2);

  const promises: Promise<SameMsgRes>[] = [];
  let job0 = {} as JobItem<SameMsgReq, SameMsgRes>;
  let job1 = {} as JobItem<SameMsgReq, SameMsgRes>;
  promises.push(
    new Promise<SameMsgRes>((resolve, reject) => {
      job0 = {
        ...job,
        pks: job.pks.slice(0, half),
        sigs: job.sigs.slice(0, half),
        resolve,
        reject,
      };
    })
  );
  promises.push(
    new Promise<SameMsgRes>((resolve, reject) => {
      job1 = {
        ...job,
        pks: job.pks.slice(half),
        sigs: job.sigs.slice(half),
        resolve,
        reject,
      };
    })
  );

  return [job0, job1];
}

function getJobResultError(jobResult: WorkResultError | null, i: number): Error {
  const workerError = jobResult ? Error(jobResult.error.message) : Error(`No jobResult for index ${i}`);
  if (jobResult?.error?.stack) workerError.stack = jobResult.error.stack;
  return workerError;
}

async function verifyMultipleSignaturesSameMessages(jobs: SameMsgReq[]): Promise<boolean[]> {
  const results: boolean[] = [];
  for (const job of jobs) {
    results.push(verifyMultipleSignaturesSameMessage(job.msg, job.pks, job.sigs));
  }
  return results;
}

async function verifyManySignatureSets(workReqArr: BlsWorkReq[]): Promise<BlsWorkResult> {
  const [startSec, startNs] = process.hrtime();
  const results: WorkResult<boolean>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  // If there are multiple batchable sets attempt batch verification with them
  const batchableSets: {idx: number; sets: SignatureSet[]}[] = [];
  const nonBatchableSets: {idx: number; sets: SignatureSet[]}[] = [];

  // Split sets between batchable and non-batchable preserving their original index in the req array
  for (let i = 0; i < workReqArr.length; i++) {
    const workReq = workReqArr[i];
    const sets = workReq.sets;

    if (workReq.opts.batchable) {
      batchableSets.push({idx: i, sets});
    } else {
      nonBatchableSets.push({idx: i, sets});
    }
  }

  if (batchableSets.length > 0) {
    // Split batchable into chunks of max size ~ 32 to minimize cost if a sig is wrong
    const batchableChunks = chunkifyMaximizeChunkSize(batchableSets, BATCHABLE_MIN_PER_CHUNK);

    for (const batchableChunk of batchableChunks) {
      const allSets: SignatureSet[] = [];
      for (const {sets} of batchableChunk) {
        for (const set of sets) {
          allSets.push(set);
        }
      }

      try {
        // Attempt to verify multiple sets at once
        const isValid = await verifySignatureSetsMaybeBatch(allSets);

        if (isValid) {
          // The entire batch is valid, return success to all
          for (const {idx, sets} of batchableChunk) {
            batchSigsSuccess += sets.length;
            results[idx] = {code: WorkResultCode.success, result: isValid};
          }
        } else {
          batchRetries++;
          // Re-verify all sigs
          nonBatchableSets.push(...batchableChunk);
        }
      } catch (e) {
        // TODO: Ignore this error expecting that the same error will happen when re-verifying the set individually
        //       It's not ideal but '@chainsafe/blst' may throw errors on some conditions
        batchRetries++;
        // Re-verify all sigs
        nonBatchableSets.push(...batchableChunk);
      }
    }
  }

  for (const {idx, sets} of nonBatchableSets) {
    try {
      const isValid = await verifySignatureSetsMaybeBatch(sets);
      results[idx] = {code: WorkResultCode.success, result: isValid};
    } catch (e) {
      results[idx] = {code: WorkResultCode.error, error: e as Error};
    }
  }

  const [workerEndSec, workerEndNs] = process.hrtime();

  return {
    batchRetries,
    batchSigsSuccess,
    workerStartTime: [startSec, startNs],
    workerEndTime: [workerEndSec, workerEndNs],
    results,
  };
}
