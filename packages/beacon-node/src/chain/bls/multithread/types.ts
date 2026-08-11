import {VerifySignatureOpts} from "../interface.js";

export type WorkerData = {
  workerId: number;
};

/**
 * Signature set as shipped to a BLS worker. Mirrors ISignatureSet
 * (state-transition), but `indexed`/`aggregate` sets carry validator
 * indices and are resolved by the worker from the process-wide native
 * pubkey cache. String literals match the SignatureSetType enum values;
 * kept literal so the worker bundle does not import state-transition.
 */
export type SerializedSet =
  | {type: "single"; publicKey: Uint8Array; message: Uint8Array; signature: Uint8Array}
  | {type: "indexed"; index: number; message: Uint8Array; signature: Uint8Array}
  | {type: "aggregate"; indices: number[]; message: Uint8Array; signature: Uint8Array};

export type BlsWorkReq = {
  opts: VerifySignatureOpts;
  sets: SerializedSet[];
};

export enum WorkResultCode {
  success = "success",
  error = "error",
}

export type WorkResultError = {code: WorkResultCode.error; error: Error};
export type WorkResult<R> = {code: WorkResultCode.success; result: R} | WorkResultError;

export type BlsWorkResult = {
  /** Ascending integer identifying the worker for metrics */
  workerId: number;
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
