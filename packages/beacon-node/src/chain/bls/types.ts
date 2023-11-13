import {PublicKey, SignatureSet} from "@chainsafe/blst-ts";
import {ISignatureSet} from "@lodestar/state-transition";
import {VerifySignatureOpts} from "./interface.js";

export type WorkerData = {
  implementation?: "herumi" | "blst-native";
  workerId: number;
};

/**
 *
 * BlsQueuedJob
 *
 */
export type QueuedJob = QueuedJobDefault | QueuedJobSameMessage;

export type QueuedJobDefault = {
  type: QueueJobType.default;
  resolve: (result: boolean) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: VerifySignatureOpts;
  sets: ISignatureSet[];
};

export type QueuedJobSameMessage = {
  type: QueueJobType.sameMessage;
  resolve: (result: boolean[]) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: VerifySignatureOpts;
  sets: {publicKey: PublicKey; signature: Uint8Array}[];
  message: Uint8Array;
};

export enum QueueJobType {
  default = "default",
  sameMessage = "same_message",
}

/**
 *
 * BlsWorkReq
 *
 */
export type BlsWorkReq = {
  opts: VerifySignatureOpts;
  sets: SignatureSet[];
};

/**
 *
 * BlsWorkResult
 *
 */
export type BlsWorkResult = {
  /** Ascending integer identifying the worker for metrics */
  workerId?: number;
  /** Total num of batches that had to be retried */
  batchRetries: number;
  /** Total num of sigs that have been successfully verified with batching */
  batchSigsSuccess: number;
  /** Time worker function starts - UNIX timestamp in seconds and nanoseconds */
  workerStartTime: [number, number];
  /** Time worker function ends - UNIX timestamp in seconds and nanoseconds */
  workerEndTime: [number, number];

  results: WorkResult<boolean>[];
};

export enum WorkResultCode {
  success = "success",
  error = "error",
}

export type WorkResult<R> = {code: WorkResultCode.success; result: R} | WorkResultError;
export type WorkResultError = {code: WorkResultCode.error; error: Error};
