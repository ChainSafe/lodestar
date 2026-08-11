import {PublicKey, asyncAggregateWithRandomness} from "@chainsafe/lodestar-z/blst";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../../metrics/metrics.js";
import {LinkedList} from "../../../util/array.js";
import {VerifySignatureOpts} from "../interface.js";
import {BlsWorkReq, SerializedSet} from "./types.js";

export type JobQueueItem = JobQueueItemDefault | JobQueueItemSameMessage;

export type JobQueueItemDefault = {
  type: JobQueueItemType.default;
  resolve: (result: boolean) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: VerifySignatureOpts;
  sets: ISignatureSet[];
};

export type JobQueueItemSameMessage = {
  type: JobQueueItemType.sameMessage;
  resolve: (result: boolean[]) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: VerifySignatureOpts;
  sets: {publicKey: PublicKey; signature: Uint8Array}[];
  message: Uint8Array;
};

export enum JobQueueItemType {
  default = "default",
  sameMessage = "same_message",
}

/**
 * Return count of signature sets from a JobQueueItem
 */
export function jobItemSigSets(job: JobQueueItem): number {
  switch (job.type) {
    case JobQueueItemType.default:
      return job.sets.length;
    case JobQueueItemType.sameMessage:
      return 1;
  }
}

/**
 * Prepare BlsWorkReq from JobQueueItem.
 * Indexed and aggregate sets ship validator indices; the worker resolves
 * them from the shared native pubkey cache. Only the sameMessage case can
 * throw here (signature aggregation of untrusted input).
 */
export async function jobItemWorkReq(job: JobQueueItem, metrics: Metrics | null): Promise<BlsWorkReq> {
  switch (job.type) {
    case JobQueueItemType.default:
      return {
        opts: job.opts,
        sets: job.sets.map((set): SerializedSet => {
          switch (set.type) {
            case SignatureSetType.single:
              return {
                type: "single",
                publicKey: set.pubkey.toBytes(),
                message: set.signingRoot,
                signature: set.signature,
              };
            case SignatureSetType.indexed:
              return {type: "indexed", index: set.index, message: set.signingRoot, signature: set.signature};
            case SignatureSetType.aggregate:
              return {type: "aggregate", indices: set.indices, message: set.signingRoot, signature: set.signature};
          }
        }),
      };
    case JobQueueItemType.sameMessage: {
      const timer = metrics?.blsThreadPool.aggregateWithRandomnessAsyncDuration.startTimer();
      // this can throw, handled in the consumer code
      const {pk, sig} = await asyncAggregateWithRandomness(
        job.sets.map((set) => ({pk: set.publicKey, sig: set.signature}))
      );
      timer?.();

      return {
        opts: job.opts,
        sets: [
          {
            type: "single",
            publicKey: pk.toBytes(),
            signature: sig.toBytes(),
            message: job.message,
          },
        ],
      };
    }
  }
}

/**
 * Convert a JobQueueItemSameMessage into multiple JobQueueItemDefault linked to the original promise
 */
export function jobItemSameMessageToMultiSet(job: JobQueueItemSameMessage): LinkedList<JobQueueItemDefault> {
  // Retry each individually
  // Create new jobs for each pubkey set, and Promise.all all the results
  const promises: Promise<boolean>[] = [];
  const jobs = new LinkedList<JobQueueItemDefault>();

  for (const set of job.sets) {
    promises.push(
      new Promise<boolean>((resolve, reject) => {
        jobs.push({
          type: JobQueueItemType.default,
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
