import {ISignatureSet} from "@lodestar/state-transition";
import {SameMessageSignatureSet, VerifySignatureOpts} from "../interface.js";
import {toBlsSignatureSet} from "../utils.js";
import {BlsWorkReq, JobQueueItemType} from "./types.js";

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
  sets: SameMessageSignatureSet[];
  message: Uint8Array;
};

/**
 * Return count of signature sets from a JobQueueItem
 */
export function jobItemSigSets(job: JobQueueItem): number {
  return job.sets.length;
}

/**
 * Prepare BlsWorkReq from JobQueueItem
 * WARNING: May throw with untrusted user input
 */
export function jobItemWorkReq(job: JobQueueItem): BlsWorkReq {
  switch (job.type) {
    case JobQueueItemType.default:
      return {
        type: JobQueueItemType.default,
        opts: job.opts,
        sets: job.sets.map(toBlsSignatureSet),
      };
    case JobQueueItemType.sameMessage:
      return {
        type: JobQueueItemType.sameMessage,
        opts: job.opts,
        sets: job.sets,
        message: job.message,
      };
  }
}
