import {VerifySignatureOpts} from "../interface.js";

export enum ApiName {
  verifySignatureSets = "verifySignatureSets",
  verifySignatureSetsSameSigningRoot = "verifySignatureSetsSameSigningRoot",
}

export type WorkerData = {
  implementation: "herumi" | "blst-native";
  workerId: number;
};

export type SerializedSet = {
  publicKey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
};

export type BlsWorkReq = {
  opts: VerifySignatureOpts;
  sets: SerializedSet[];
};

export enum WorkResultCode {
  success = "success",
  error = "error",
}

export type WorkResult<R> = {code: WorkResultCode.success; result: R} | {code: WorkResultCode.error; error: Error};

export type BlsWorkResult = {
  /** Ascending integer identifying the worker for metrics */
  workerId: number;
  /** Total num of batches that had to be retried */
  batchRetries: number;
  /** Total num of sigs that have been successfully verified with batching */
  batchSigsSuccess: number;
  /** Time worker function starts - UNIX timestamp in nanoseconds */
  workerStartNs: bigint;
  /** Time worker function ends - UNIX timestamp in nanoseconds */
  workerEndNs: bigint;
  results: WorkResult<boolean>[];
};

/**
 * A job item we want to get a result for.
 */
export type JobItem<W = BlsWorkReq | SerializedSet, R = boolean> = {
  resolve: (result: R | PromiseLike<R>) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  workReq: W;
};

/**
 * An item in the queue. Could be BlsWorkReq or SerializedSet[] of the same message.
 */
export type QueueItem = JobItem<BlsWorkReq> | JobItem<SerializedSet>[];

export type Jobs =
  | {
      isSameMessageJobs: false;
      jobs: JobItem<BlsWorkReq>[];
    }
  | {
      isSameMessageJobs: true;
      jobs: JobItem<SerializedSet>[];
    };
