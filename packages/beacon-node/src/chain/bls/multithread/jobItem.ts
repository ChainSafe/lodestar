import * as swigBindings from "@chainsafe/blst/dist/bindings.js";
import * as blst from "@chainsafe/blst";
import bls from "@chainsafe/bls";
import {CoordType, PointFormat, PublicKey} from "@chainsafe/bls/types";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {QueuedVerificationOptions} from "../interface.js";
import {getAggregatedPubkey} from "../utils.js";
import {LinkedList} from "../../../util/array.js";
import {Metrics} from "../../../metrics/metrics.js";
import {BlsWorkReq} from "./types.js";
import {randomBytesNonZero} from "./utils.js";

export type JobQueueItem = JobQueueItemDefault | JobQueueItemSameMessage;

export type JobQueueItemDefault = {
  type: JobQueueItemType.default;
  resolve: (result: boolean) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: QueuedVerificationOptions;
  sets: ISignatureSet[];
};

export type JobQueueItemSameMessage = {
  type: JobQueueItemType.sameMessage;
  resolve: (result: boolean[]) => void;
  reject: (error?: Error) => void;
  addedTimeMs: number;
  opts: QueuedVerificationOptions;
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
export function jobItemWorkReq(job: JobQueueItem, format: PointFormat, metrics: Metrics | null): BlsWorkReq {
  switch (job.type) {
    case JobQueueItemType.default:
      return {
        opts: job.opts,
        sets: job.sets.map((set) => ({
          // this can throw, handled in the consumer code
          publicKey: getAggregatedPubkey(set, metrics).toBytes(format),
          signature: set.signature,
          message: set.signingRoot,
        })),
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

      // adding verification randomness is swig specific. must not attempt with herumi until
      // @chainsafe/bls is updated to support it with herumi
      if (job.opts.addVerificationRandomness) {
        const pkPoint = new swigBindings.blst.P1();
        const sigPoint = new swigBindings.blst.P2();
        for (let i = 0; i < job.sets.length; i++) {
          const randomness = randomBytesNonZero(8);
          // cast to unknown here because the blst-native version of the bls library extends the 
          // PublicKey from the blst library, but the herumi version does not so the interface does
          // not show that this is possible
          pkPoint.add((job.sets[i].publicKey as unknown as blst.PublicKey).jacobian.mult(randomness));
          const sig = blst.Signature.fromBytes(job.sets[i].signature, CoordType.affine);
          sig.sigValidate();
          sigPoint.add(sig.jacobian.mult(randomness));
        }
        timer?.();
        return {
          opts: job.opts,
          sets: [
            {
              publicKey: pkPoint.serialize(),
              signature: sigPoint.serialize(),
              message: job.message,
            },
          ],
        };
      }

      const signatures = job.sets.map((set) => bls.Signature.fromBytes(set.signature, CoordType.affine, true));
      timer?.();

      return {
        opts: job.opts,
        sets: [
          {
            publicKey: bls.PublicKey.aggregate(job.sets.map((set) => set.publicKey)).toBytes(format),
            signature: bls.Signature.aggregate(signatures).toBytes(format),
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
