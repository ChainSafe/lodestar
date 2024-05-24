import {PublicKey, aggregatePublicKeys} from "@chainsafe/blst";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/metrics.js";
import {WorkResultError} from "./types.js";

export function getAggregatedPubkey(signatureSet: ISignatureSet, metrics: Metrics | null = null): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate: {
      const timer = metrics?.blsThreadPool.pubkeysAggregationMainThreadDuration.startTimer();
      const pubkeys = aggregatePublicKeys(signatureSet.pubkeys);
      timer?.();
      return pubkeys;
    }

    default:
      throw Error("Unknown signature set type");
  }
}

export function getAggregatedPubkeysCount(signatureSets: ISignatureSet[]): number {
  let pubkeysConut = 0;
  for (const set of signatureSets) {
    if (set.type === SignatureSetType.aggregate) {
      pubkeysConut += set.pubkeys.length;
    }
  }
  return pubkeysConut;
}

/**
 * Splits an array into an array of arrays maximizing the size of the smallest chunk.
 */
export function chunkifyMaximizeChunkSize<T>(arr: T[], minPerChunk: number): T[][] {
  const chunkCount = Math.floor(arr.length / minPerChunk);
  if (chunkCount <= 1) {
    return [arr];
  }

  // Prefer less chunks of bigger size
  const perChunk = Math.ceil(arr.length / chunkCount);
  const arrArr: T[][] = [];

  for (let i = 0; i < arr.length; i += perChunk) {
    arrArr.push(arr.slice(i, i + perChunk));
  }

  return arrArr;
}

export function getJobResultError(jobResult: WorkResultError | null, i: number): Error {
  const workerError = jobResult ? Error(jobResult.error.message) : Error(`No jobResult for index ${i}`);
  if (jobResult?.error?.stack) workerError.stack = jobResult.error.stack;
  return workerError;
}
