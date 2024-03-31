import bls from "@chainsafe/bls";
import {CoordType, SignatureSet, PublicKey} from "@chainsafe/bls/types";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/metrics.js";
import {WorkRequestSet, WorkResultError} from "./types.js";

export function getAggregatedPubkey(signatureSet: ISignatureSet, metrics: Metrics | null = null): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate: {
      const timer = metrics?.blsThreadPool.pubkeysAggregationMainThreadDuration.startTimer();
      const pubkeys = bls.PublicKey.aggregate(signatureSet.pubkeys);
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

/**
 * `rand` must not be exactly zero. Otherwise it would allow the verification of invalid signatures
 * See https://github.com/ChainSafe/blst-ts/issues/45
 */
export function randomBytesNonZero(bytesCount: number): Uint8Array {
  const rand = crypto.getRandomValues(new Uint8Array(bytesCount));
  for (let i = 0; i < bytesCount; i++) {
    if (rand[i] !== 0) return rand;
  }
  rand[0] = 1;
  return rand;
}

export function deserializeSet(set: WorkRequestSet): SignatureSet {
  return {
    message: set.message,
    publicKey:
      set.publicKey instanceof bls.PublicKey
        ? set.publicKey
        : // no need to validate key, is validated when deserialized from state at startup
          bls.PublicKey.fromBytes(set.publicKey, CoordType.affine),
    signature:
      set.signature instanceof bls.Signature
        ? set.signature
        : bls.Signature.fromBytes(set.signature, CoordType.affine, true),
  };
}

export function getJobResultError(jobResult: WorkResultError | null, i: number): Error {
  const workerError = jobResult ? Error(jobResult.error.message) : Error(`No jobResult for index ${i}`);
  if (jobResult?.error?.stack) workerError.stack = jobResult.error.stack;
  return workerError;
}
