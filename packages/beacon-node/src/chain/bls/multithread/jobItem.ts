import {PublicKey, aggregateWithRandomness} from "@chainsafe/blst";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {Metrics} from "../../../metrics/metrics.js";
import {LinkedList} from "../../../util/array.js";
import {VerifySignatureOpts} from "../interface.js";
import {getAggregatedPubkey} from "../utils.js";
import {BlsWorkReq} from "./types.js";

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
 * Prepare BlsWorkReq from JobQueueItem
 * WARNING: May throw with untrusted user input
 */
export function jobItemWorkReq(job: JobQueueItem, metrics: Metrics | null): BlsWorkReq {
  switch (job.type) {
    case JobQueueItemType.default:
      return {
        opts: job.opts,
        sets: job.sets.map((set) => ({
          // this can throw, handled in the consumer code
          publicKey: getAggregatedPubkey(set, metrics).toBytes(),
          signature: set.signature,
          message: set.signingRoot,
        })),
      };
    case JobQueueItemType.sameMessage: {
      // This is slow code on main thread (mainly signature deserialization + group check).
      // Ideally it can be taken off-thread, but in the mean time, keep track of total time spent here.
      // As of July 2024, for a node subscribing to all subnets, with 1 signature per validator per epoch,
      // it takes around 2.02 min to perform this operation for a single epoch.
      // cpu profile on main thread has 250s idle so this only works until we reach 3M validators
      // However, for normal node with only 2 to 7 subnet subscriptions per epoch this works until 27M validators
      // and not a problem in the near future
      // this is monitored on v1.21.0 https://github.com/ChainSafe/lodestar/pull/6894/files#r1687359225
      const timer = metrics?.blsThreadPool.aggregateWithRandomnessMainThreadDuration.startTimer();
      const {pk, sig} = aggregateWithRandomness(job.sets.map((set) => ({pk: set.publicKey, sig: set.signature})));
      timer?.();

      return {
        opts: job.opts,
        sets: [
          {
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
