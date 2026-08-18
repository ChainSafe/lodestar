import {type BlsSignatureSet} from "@chainsafe/lodestar-z/bls-verifier";
import {SameMessageSignatureSet, VerifySignatureOpts} from "../interface.js";

export type WorkerData = {
  workerId: number;
};

export enum JobQueueItemType {
  default = "default",
  sameMessage = "same_message",
}

export type BlsWorkReqDefault = {
  type: JobQueueItemType.default;
  opts: VerifySignatureOpts;
  sets: BlsSignatureSet[];
};

export type BlsWorkReqSameMessage = {
  type: JobQueueItemType.sameMessage;
  opts: VerifySignatureOpts;
  sets: SameMessageSignatureSet[];
  message: Uint8Array;
};

export type BlsWorkReq = BlsWorkReqDefault | BlsWorkReqSameMessage;

export enum WorkResultCode {
  success = "success",
  error = "error",
}

export enum VerificationCallOperation {
  generalBatch = "general_batch",
  generalDirect = "general_direct",
  generalFallback = "general_fallback",
  sameMessage = "same_message",
}

export type VerificationCall = {
  operation: VerificationCallOperation;
  duration: number;
  signatureSets: number;
};

export type WorkResultError = {code: WorkResultCode.error; error: Error};
export type WorkResult<R> = {code: WorkResultCode.success; result: R} | WorkResultError;

export type BlsWorkResult = {
  /** Ascending integer identifying the worker for metrics */
  workerId: number;
  /** Total num of batches that had to be retried */
  batchRetries: number;
  /** Total num of sigs that have been successfully verified with batching */
  batchSigsSuccess: number;
  /** Every lodestar-z verification call made while processing this work group */
  verificationCalls: VerificationCall[];
  /** Time worker function starts - UNIX timestamp in seconds and nanoseconds */
  workerStartTime: [number, number];
  /** Time worker function ends - UNIX timestamp in seconds and nanoseconds */
  workerEndTime: [number, number];
  results: WorkResult<boolean[]>[];
};
