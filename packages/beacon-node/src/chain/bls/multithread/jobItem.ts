import bls from "@chainsafe/bls";
import {CoordType, PointFormat, PublicKey} from "@chainsafe/bls/types";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {QueuedVerificationOpts} from "../interface.js";
import {getAggregatedPubkey} from "../utils.js";
import {LinkedList} from "../../../util/array.js";
import {Metrics} from "../../../metrics/metrics.js";
import {BlsWorkReq, LibuvSafeSet, WorkRequestSet, WorkerSafeSet} from "./types.js";
import {randomBytesNonZero} from "./utils.js";

export type JobQueueItem = JobQueueItemDefault | JobQueueItemSameMessage;

export type JobQueueItemDefault = {
  type: JobQueueItemType.default;
  resolve: (result: boolean) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: QueuedVerificationOpts;
  sets: ISignatureSet[];
};

export type JobQueueItemSameMessage = {
  type: JobQueueItemType.sameMessage;
  resolve: (result: boolean[]) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: QueuedVerificationOpts;
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
export function jobItemWorkReq(
  deserialized: boolean,
  job: JobQueueItem,
  format: PointFormat,
  metrics: Metrics | null
): BlsWorkReq {
  switch (job.type) {
    case JobQueueItemType.default:
      return {
        opts: job.opts,
        sets: job.sets.map(function setMapDefault(set) {
          return {
            // this can throw, but likely keys will not unless there is a code error
            // so handled in the consumer code
            //
            // only serialize the keys to cross the worker boundary. signatures stay
            // serialized until inside try/catch with verification functions as they
            // come across the network and are not trusted
            publicKey: deserialized
              ? getAggregatedPubkey(set, metrics)
              : getAggregatedPubkey(set, metrics).toBytes(format),
            signature: set.signature,
            message: set.signingRoot,
          } as WorkRequestSet;
        }),
      };
    case JobQueueItemType.sameMessage: {
      // validate signature = true, this is slow code on main thread so should only run with network thread mode (useWorker=true)
      // For a node subscribing to all subnets, with 1 signature per validator per epoch it takes around 80s
      // to deserialize 750_000 signatures per epoch
      // cpu profile on main thread has 250s idle so this only works until we reach 3M validators
      // However, for normal node with only 2 to 7 subnet subscriptions per epoch this works until 27M validators
      // and not a problem in the near future
      // this is monitored on v1.11.0 https://github.com/ChainSafe/lodestar/pull/5912#issuecomment-1700320307
      const timer = metrics?.blsThreadPool.signatureDeserializationMainThreadDuration.startTimer();
      const signatures = job.sets.map(function sigMapSameMessage(set) {
        return bls.Signature.fromBytes(set.signature, CoordType.affine, true);
      });
      timer?.();

      if (job.opts.disableSameMessageVerificationRandomness) {
        const pk = bls.PublicKey.aggregate(job.sets.map((set) => set.publicKey));
        const sig = bls.Signature.aggregate(signatures);
        return {
          opts: job.opts,
          sets: [
            deserialized
              ? ({
                  publicKey: pk,
                  signature: sig,
                  message: job.message,
                } as LibuvSafeSet)
              : ({
                  publicKey: pk.toBytes(),
                  signature: sig.toBytes(),
                  message: job.message,
                } as WorkerSafeSet),
          ],
        };
      }

      // adding verification randomness is napi specific. must not attempt with herumi until
      // @chainsafe/bls is updated to support it with herumi
      const randomness: Uint8Array[] = [];
      for (let i = 0; i < job.sets.length; i++) {
        randomness.push(randomBytesNonZero(8));
      }
      const pk = bls.PublicKey.aggregate(job.sets.map((set, i) => set.publicKey.multiplyBy(randomness[i])));
      const sig = bls.Signature.aggregate(signatures.map((sig, i) => sig.multiplyBy(randomness[i])));
      return {
        opts: job.opts,
        sets: [
          deserialized
            ? ({
                publicKey: pk,
                signature: sig,
                message: job.message,
              } as LibuvSafeSet)
            : ({
                publicKey: pk.toBytes(),
                signature: sig.toBytes(),
                message: job.message,
              } as WorkerSafeSet),
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
