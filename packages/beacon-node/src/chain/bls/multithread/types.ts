import {PublicKey, Signature} from "@chainsafe/bls/types";
import {QueuedVerificationOpts} from "../interface.js";

export enum BlsPoolType {
  workers = "workers",
  libuv = "libuv",
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

export type DeserializedKeySet = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

export type DeserializedSet = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Signature;
};

export type WorkRequestSet = SerializedSet | DeserializedKeySet | DeserializedSet;

export type BlsWorkReq = {
  opts: QueuedVerificationOpts;
  sets: WorkRequestSet[];
};

export enum WorkResultCode {
  success = "success",
  error = "error",
}

export type WorkResultError = {code: WorkResultCode.error; error: Error};
export type WorkResult<R> = {code: WorkResultCode.success; result: R} | WorkResultError;

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
