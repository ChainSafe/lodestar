import bls from "@chainsafe/bls";
import {CoordType, PointFormat, PublicKey} from "@chainsafe/bls/types";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {VerifySignatureOpts} from "../interface.js";
import {getAggregatedPubkey} from "../utils.js";
import {LinkedList} from "../../../util/array.js";
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
export function jobItemWorkReq(job: JobQueueItem, format: PointFormat): BlsWorkReq {
  switch (job.type) {
    case JobQueueItemType.default:
      return {
        opts: job.opts,
        sets: job.sets.map((set) => ({
          // this can throw, handled in the consumer code
          publicKey: getAggregatedPubkey(set).toBytes(format),
          signature: set.signature,
          message: set.signingRoot,
        })),
      };
    case JobQueueItemType.sameMessage:
      return {
        opts: job.opts,
        sets: [
          {
            publicKey: bls.PublicKey.aggregate(job.sets.map((set) => set.publicKey)).toBytes(format),
            signature: bls.Signature.aggregate(
              // validate signature = true
              job.sets.map((set) => bls.Signature.fromBytes(set.signature, CoordType.affine, true))
            ).toBytes(format),
            message: job.message,
          },
        ],
      };
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
