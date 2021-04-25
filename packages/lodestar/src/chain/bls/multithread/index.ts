import {spawn, Worker} from "threads";
import {defaultPoolSize} from "threads/dist/master/implementation";
// `threads` library creates self global variable which breaks `timeout-abort-controller` https://github.com/jacobheun/timeout-abort-controller/issues/9
// Don't add an eslint disable here as a reminder that this has to be fixed eventually
// @ts-ignore
// eslint-disable-next-line
self = undefined;
import {AbortSignal} from "abort-controller";
import {Implementation, PointFormat, PublicKey} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils";
import {QueueError, QueueErrorCode} from "../../../util/queue";
import {wrapError} from "../../../util/wrapError";
import {BlsWorkReq, WorkerData, WorkResult, WorkResultCode} from "./types";
import {chunkifyMaximizeChunkSize} from "./utils";

/**
 * Split big signature sets into smaller sets so they can be sent to multiple workers.
 * The biggest sets happen during sync, on mainnet batches of 64 blocks have around ~8000 signatures.
 * The latency cost of sending the job to and from the worker is aprox a single sig verification.
 * If you split a big signature into 2, the extra time cost is `(2+2N)/(1+2N)`.
 * For 128, the extra time cost is about 0.3%. No specific reasoning for `128`, it's just good enough.
 */
const MAX_SIGNATURE_SETS_PER_JOB = 128;

type WorkerApi = {
  doManyBlsWorkReq(workReqArr: BlsWorkReq[]): Promise<WorkResult<boolean>[]>;
};

type JobQueueItem<R = boolean> = {
  resolve: (result: R | PromiseLike<R>) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  workReq: BlsWorkReq;
};

enum WorkerStatusCode {
  notInitialized,
  initializing,
  initializationError,
  idle,
  running,
}

type WorkerStatus =
  | {code: WorkerStatusCode.notInitialized}
  | {code: WorkerStatusCode.initializing; initPromise: Promise<WorkerApi>}
  | {code: WorkerStatusCode.initializationError; error: Error}
  | {code: WorkerStatusCode.idle; workerApi: WorkerApi}
  | {code: WorkerStatusCode.running; workerApi: WorkerApi};

type WorkerDescriptor = {
  worker: Worker;
  status: WorkerStatus;
};

/**
 * Wraps "threads" library thread pool queue system with the goals:
 * - Complete total outstanding jobs in total minimum time possible.
 *   Will split large signature sets into smaller sets and send to different workers
 * - Reduce the latency cost for small signature sets. In NodeJS 12,14 worker <-> main thread
 *   communiction has very high latency, of around ~5 ms. So package multiple small signature
 *   sets into packages of work and send at once to a worker to distribute the latency cost
 */
export class BlsMultiThreadWorkerPool {
  private readonly logger: ILogger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly format: PointFormat;
  private readonly signal: AbortSignal;
  private readonly jobs: JobQueueItem[] = [];
  private readonly workers: WorkerDescriptor[];

  constructor(logger: ILogger, implementation: Implementation, signal: AbortSignal) {
    this.logger = logger;
    this.signal = signal;

    // Use compressed for herumi for now.
    // THe worker is not able to deserialize from uncompressed
    // `Error: err _wrapDeserialize`
    this.format = implementation === "blst-native" ? PointFormat.uncompressed : PointFormat.compressed;
    this.workers = this.createWorkers(implementation, defaultPoolSize);

    this.signal.addEventListener("abort", this.abortAllJobs, {once: true});
    this.signal.addEventListener("abort", this.terminateAllWorkers, {once: true});
  }

  async verifySignatureSets(
    sets: {publicKey: PublicKey; message: Uint8Array; signature: Uint8Array}[],
    validateSignature: boolean
  ): Promise<boolean> {
    const results = await Promise.all(
      chunkifyMaximizeChunkSize(sets, MAX_SIGNATURE_SETS_PER_JOB).map((setsWorker) =>
        this.queueBlsWork({
          validateSignature,
          sets: setsWorker.map((s) => ({
            publicKey: s.publicKey.toBytes(this.format),
            message: s.message,
            signature: s.signature,
          })),
        })
      )
    );

    // .every on an empty array returns true
    if (results.length === 0) {
      throw Error("Empty results array");
    }

    return results.every((isValid) => isValid === true);
  }

  private createWorkers(implementation: Implementation, poolSize: number): WorkerDescriptor[] {
    const workers: WorkerDescriptor[] = [];

    for (let i = 0; i < poolSize; i++) {
      const workerData: WorkerData = {implementation};
      const worker = new Worker("./worker", {workerData} as ConstructorParameters<typeof Worker>[1]);

      const workerDescriptor: WorkerDescriptor = {
        worker,
        status: {code: WorkerStatusCode.notInitialized},
      };
      workers.push(workerDescriptor);

      // TODO: Consider initializing only when necessary
      const initPromise = spawn<WorkerApi>(worker, {
        // A Lodestar Node may do very expensive task at start blocking the event loop and causing
        // the initialization to timeout. The number below is big enough to almost disable the timeout
        timeout: 5 * 60 * 1000,
      });

      workerDescriptor.status = {code: WorkerStatusCode.initializing, initPromise};

      initPromise
        .then((workerApi) => {
          workerDescriptor.status = {code: WorkerStatusCode.idle, workerApi};
          // Potentially run jobs that were queued before initialization of the first worker
          setTimeout(this.runJob, 0);
        })
        .catch((error: Error) => {
          workerDescriptor.status = {code: WorkerStatusCode.initializationError, error};
        });
    }

    return workers;
  }

  /**
   * Queue a task and return a promise that resolves once the task has been dequeued,
   * started and finished.
   *
   * @param task An async function that takes a thread instance and invokes it.
   */
  private async queueBlsWork(workReq: BlsWorkReq): Promise<boolean> {
    if (this.signal.aborted) {
      throw new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    }

    // TODO: Consider if limiting queue size is necessary here.
    // It would be bad to reject signatures because the node is slow.
    // However, if the worker communication broke jobs won't ever finish

    // TODO: Throw only if all validators have failed
    if (
      this.workers.length > 0 &&
      this.workers[0].status.code === WorkerStatusCode.initializationError &&
      this.workers.every((worker) => worker.status.code === WorkerStatusCode.initializationError)
    ) {
      throw this.workers[0].status.error;
    }

    return await new Promise<boolean>((resolve, reject) => {
      const addedTimeMs = Date.now();
      this.jobs.push({resolve, reject, addedTimeMs, workReq});
      setTimeout(this.runJob, 0);
    });
  }

  private runJob = async (): Promise<void> => {
    if (this.signal.aborted) {
      return;
    }

    // Find iddle worker
    const worker = this.workers.find((worker) => worker.status.code === WorkerStatusCode.idle);
    if (!worker || worker.status.code !== WorkerStatusCode.idle) {
      return;
    }

    // Prepare work package
    const jobs = this.prepareWork();
    if (jobs.length === 0) {
      return;
    }

    // TODO: Metrics
    // for (const job of jobs) {
    //   this.metrics?.jobWaitTime.observe((Date.now() - job.addedTimeMs) / 1000);
    // }

    // TODO: After sending the work to the worker the main thread can drop the job arguments
    // and free-up memory, only need to keep the job's Promise handlers

    const workerApi = worker.status.workerApi;
    worker.status = {code: WorkerStatusCode.running, workerApi};

    // Send work package to the worker
    const workerResult = await wrapError(workerApi.doManyBlsWorkReq(jobs.map((job) => job.workReq)));

    worker.status = {code: WorkerStatusCode.idle, workerApi};

    if (workerResult.err) {
      // Reject all
      for (const job of jobs) {
        job.reject(workerResult.err);
      }
    } else {
      // Un-wrap work package
      const results = workerResult.result;
      for (const [i, result] of results.entries()) {
        const job = jobs[i];
        if (result.code === WorkResultCode.success) {
          // Metrics
          // this.metrics.blsMultiThreadSigCount.add(workReq.sets.length);
          // this.metrics.blsMultiThreadWorkerTiem.add(result.workerJobTimeMs);

          job.resolve(result.result);
        } else {
          job.reject(Error(result.error.message));
        }
      }
    }

    // Potentially run a new job
    setTimeout(this.runJob, 0);
  };

  /**
   * Grab pending work up to a max number of signatures
   */
  private prepareWork(): JobQueueItem<boolean>[] {
    const jobs: JobQueueItem<boolean>[] = [];
    let totalSigs = 0;

    while (totalSigs < MAX_SIGNATURE_SETS_PER_JOB) {
      const job = this.jobs.shift();
      if (!job) {
        break;
      }

      jobs.push(job);
      totalSigs += job.workReq.sets.length;
    }

    return jobs;
  }

  /**
   * Stop all JavaScript execution in the worker thread immediatelly
   */
  private terminateAllWorkers = (): void => {
    for (const [id, worker] of this.workers.entries()) {
      worker.worker.terminate((error, exitCode = 0) => {
        if (error) this.logger.error("Error terminating worker", {id, exitCode}, error);
      });
    }
  };

  private abortAllJobs = (): void => {
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (job) job.reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
    }
  };
}
