import {type PublicKey, aggregatePublicKeys} from "@chainsafe/blst-ts";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {LinkedList} from "../../util/array.js";
import {QueueJobType, QueuedJob, QueuedJobDefault, QueuedJobSameMessage} from "./types.js";

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

export function getAggregatedPubkey(metrics: Metrics | null, signatureSet: ISignatureSet): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate:
      const timer = metrics?.bls.mainThread.pubkeysAggregationMainThreadDuration.startTimer();
      metrics?.bls.aggregatedPubkeys.inc(signatureSet.pubkeys.length);
      const pubkeys = aggregatePublicKeys(signatureSet.pubkeys);
      timer?.();
      return pubkeys;

    default:
      throw Error("Unknown signature set type");
  }
}

/**
 * Return count of signatures in a QueuedJob
 */
export function countSignatures(job: QueuedJob): number {
  switch (job.type) {
    case QueueJobType.default:
      return job.sets.length;
    case QueueJobType.sameMessage:
      return 1;
  }
}

/**
 * Convert a JobQueueItemSameMessage into multiple JobQueueItemDefault linked to the original promise
 */
export function jobItemSameMessageToMultiSet(job: QueuedJobSameMessage): LinkedList<QueuedJobDefault> {
  // Retry each individually
  // Create new jobs for each pubkey set, and Promise.all all the results
  const promises: Promise<boolean>[] = [];
  const jobs = new LinkedList<QueuedJobDefault>();

  for (const set of job.sets) {
    promises.push(
      new Promise<boolean>((resolve, reject) => {
        jobs.push({
          type: QueueJobType.default,
          resolve,
          reject,
          addedTimeMs: job.addedTimeMs,
          opts: {batchable: false, priority: job.opts.priority},
          sets: [
            {
              type: SignatureSetType.single,
              pubkey: set.publicKey,
              signature: set.signature,
              signingRoot: job.message,
            },
          ],
        });
      })
    );
  }

  // Connect jobs to main job
  Promise.all(promises).then(job.resolve, job.reject);

  return jobs;
}
