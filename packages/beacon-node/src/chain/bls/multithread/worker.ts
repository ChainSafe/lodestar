import worker from "node:worker_threads";
import {
  type BlsSignatureSet,
  verifySignatureSets,
  verifySignatureSetsSameMessage,
} from "@chainsafe/lodestar-z/bls-verifier";
import {expose} from "@chainsafe/threads/worker";
import {BlsWorkReq, BlsWorkResult, JobQueueItemType, WorkResult, WorkResultCode, WorkerData} from "./types.js";
import {chunkifyMaximizeChunkSize} from "./utils.js";

/**
 * Split batchable sets in chunks of minimum size 16.
 * Batch verify 16 has an aprox cost of 16+1. For 32 it's 32+1. After ~16 the additional savings are not significant.
 * However, if a sig is invalid the whole batch has to be re-verified. So it's important to keep this number low.
 * In normal network conditions almost all signatures received by the node are correct.
 * After observing metrics this number can be reviewed
 */
const BATCHABLE_MIN_PER_CHUNK = 16;

// Cloned data from instatiation
const workerData = worker.workerData as WorkerData;
if (!workerData) throw Error("workerData must be defined");
const {workerId} = workerData || {};

expose({
  async verifyManySignatureSets(workReqArr: BlsWorkReq[]): Promise<BlsWorkResult> {
    return verifyManySignatureSets(workReqArr);
  },
});

function verifyManySignatureSets(workReqArr: BlsWorkReq[]): BlsWorkResult {
  const [startSec, startNs] = process.hrtime();
  const results: WorkResult<boolean[]>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  // If there are multiple batchable sets attempt batch verification with them
  const batchableSets: {idx: number; sets: BlsSignatureSet[]}[] = [];
  const nonBatchableSets: {idx: number; sets: BlsSignatureSet[]}[] = [];

  // Split sets between batchable and non-batchable preserving their original index in the req array
  for (let i = 0; i < workReqArr.length; i++) {
    const workReq = workReqArr[i];
    switch (workReq.type) {
      case JobQueueItemType.default: {
        const {sets} = workReq;
        if (workReq.opts.batchable) {
          batchableSets.push({idx: i, sets});
        } else {
          nonBatchableSets.push({idx: i, sets});
        }
        break;
      }
      case JobQueueItemType.sameMessage:
        try {
          const result = verifySignatureSetsSameMessage(workReq.sets, workReq.message);
          results[i] = {code: WorkResultCode.success, result};
        } catch (e) {
          results[i] = {code: WorkResultCode.error, error: e as Error};
        }
        break;
    }
  }

  if (batchableSets.length > 0) {
    // Split batchable into chunks of max size ~ 32 to minimize cost if a sig is wrong
    const batchableChunks = chunkifyMaximizeChunkSize(batchableSets, BATCHABLE_MIN_PER_CHUNK);

    for (const batchableChunk of batchableChunks) {
      const allSets: BlsSignatureSet[] = [];
      for (const {sets} of batchableChunk) {
        for (const set of sets) {
          allSets.push(set);
        }
      }

      try {
        // Attempt to verify multiple sets at once
        const isValid = verifySignatureSets(allSets);

        if (isValid) {
          // The entire batch is valid, return success to all
          for (const {idx, sets} of batchableChunk) {
            batchSigsSuccess += sets.length;
            results[idx] = {code: WorkResultCode.success, result: [isValid]};
          }
        } else {
          batchRetries++;
          // Re-verify all sigs
          nonBatchableSets.push(...batchableChunk);
        }
      } catch (_e) {
        // TODO: Ignore this error expecting that the same error will happen when re-verifying the set individually
        //       It's not ideal but the BLS implementation may throw errors on some conditions
        batchRetries++;
        // Re-verify all sigs
        nonBatchableSets.push(...batchableChunk);
      }
    }
  }

  for (const {idx, sets} of nonBatchableSets) {
    try {
      const isValid = verifySignatureSets(sets);
      results[idx] = {code: WorkResultCode.success, result: [isValid]};
    } catch (e) {
      results[idx] = {code: WorkResultCode.error, error: e as Error};
    }
  }

  const [workerEndSec, workerEndNs] = process.hrtime();

  return {
    workerId,
    batchRetries,
    batchSigsSuccess,
    workerStartTime: [startSec, startNs],
    workerEndTime: [workerEndSec, workerEndNs],
    results,
  };
}
