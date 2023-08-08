import type {PublicKey} from "@chainsafe/blst-ts";
import {VerifySignatureOpts} from "../interface.js";

export type WorkerData = {
  workerId: number;
};

export type SerializedSignatureSet = {
  publicKey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
};

export type DeserializedSignatureSet = {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
};

export type SerializedBlsWorkReq = {
  opts: VerifySignatureOpts;
  sets: SerializedSignatureSet[];
};

export type DeserializedBlsWorkReq = {
  opts: VerifySignatureOpts;
  sets: DeserializedSignatureSet[];
};

export type BlsWorkReq = SerializedBlsWorkReq | DeserializedBlsWorkReq;

export enum WorkResultCode {
  success = "success",
  error = "error",
}

export type WorkResult<R> = {code: WorkResultCode.success; result: R} | {code: WorkResultCode.error; error: Error};

export type BlsWorkResult = {
  /** Ascending integer identifying the worker for metrics */
  workerId?: number;
  /** Total num of batches that had to be retried */
  batchRetries: number;
  /** Total num of sigs that have been successfully verified with batching */
  batchSigsSuccess: number;
  /** Time worker function starts - UNIX timestamp in nanoseconds */
  workStartNs: bigint;
  /** Time worker function ends - UNIX timestamp in nanoseconds */
  workEndNs: bigint;
  results: WorkResult<boolean>[];
};
