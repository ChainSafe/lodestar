import {verifySignatureSetsMaybeBatch, asyncVerifySignatureSetsMaybeBatch} from "../maybeBatch.js";
import {BlsWorkReq, WorkResult, WorkResultCode, BlsWorkResult, WorkRequestSet} from "./types.js";
import {chunkifyMaximizeChunkSize} from "./utils.js";

/**
 * Split batchable sets in chunks of minimum size 16.
 * Batch verify 16 has an aprox cost of 16+1. For 32 it's 32+1. After ~16 the additional savings are not significant.
 * However, if a sig is invalid the whole batch has to be re-verified. So it's important to keep this number low.
 * In normal network conditions almost all signatures received by the node are correct.
 * After observing metrics this number can be reviewed
 */
const BATCHABLE_MIN_PER_CHUNK = 16;

export function verifyManySignatureSets(workerId: number, workReqArr: BlsWorkReq[]): BlsWorkResult {
  const [startSec, startNs] = process.hrtime();
  const results: WorkResult<boolean>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  // If there are multiple batchable sets attempt batch verification with them
  const batchableSets: {idx: number; sets: WorkRequestSet[]}[] = [];
  const nonBatchableSets: {idx: number; sets: WorkRequestSet[]}[] = [];

  // Split sets between batchable and non-batchable preserving their original index in the req array
  for (let i = 0; i < workReqArr.length; i++) {
    const workReq = workReqArr[i];

    if (workReq.opts.batchable) {
      batchableSets.push({idx: i, sets: workReq.sets});
    } else {
      nonBatchableSets.push({idx: i, sets: workReq.sets});
    }
  }

  if (batchableSets.length > 0) {
    // Split batchable into chunks of max size ~ 32 to minimize cost if a sig is wrong
    const batchableChunks = chunkifyMaximizeChunkSize(batchableSets, BATCHABLE_MIN_PER_CHUNK);

    for (const batchableChunk of batchableChunks) {
      const allSets: WorkRequestSet[] = [];
      for (const {sets} of batchableChunk) {
        for (const set of sets) {
          allSets.push(set);
        }
      }

      try {
        // Attempt to verify multiple sets at once
        const isValid = verifySignatureSetsMaybeBatch(allSets);

        if (isValid) {
          // The entire batch is valid, return success to all
          for (const {idx, sets} of batchableChunk) {
            batchSigsSuccess += sets.length;
            results[idx] = {code: WorkResultCode.success, result: isValid};
          }
        } else {
          batchRetries++;
          // Re-verify all sigs
          nonBatchableSets.push(...batchableChunk);
        }
      } catch (e) {
        // TODO: Ignore this error expecting that the same error will happen when re-verifying the set individually
        //       It's not ideal but '@chainsafe/blst' may throw errors on some conditions
        batchRetries++;
        // Re-verify all sigs
        nonBatchableSets.push(...batchableChunk);
      }
    }
  }

  for (const {idx, sets} of nonBatchableSets) {
    try {
      const isValid = verifySignatureSetsMaybeBatch(sets);
      results[idx] = {code: WorkResultCode.success, result: isValid};
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

export async function asyncVerifyManySignatureSets(workReqArr: BlsWorkReq[]): Promise<BlsWorkResult> {
  const [startSec, startNs] = process.hrtime();
  const results: WorkResult<boolean>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  // If there are multiple batchable sets attempt batch verification with them
  const batchableSets: {idx: number; sets: WorkRequestSet[]}[] = [];
  const nonBatchableSets: {idx: number; sets: WorkRequestSet[]}[] = [];

  // Split sets between batchable and non-batchable preserving their original index in the req array
  for (let i = 0; i < workReqArr.length; i++) {
    const workReq = workReqArr[i];
    const sets = workReq.sets;

    if (workReq.opts.batchable) {
      batchableSets.push({idx: i, sets});
    } else {
      nonBatchableSets.push({idx: i, sets});
    }
  }

  const batchOperations: Promise<void>[] = [];
  if (batchableSets.length > 0) {
    // Split batchable into chunks of max size ~ 32 to minimize cost if a sig is wrong
    const batchableChunks = chunkifyMaximizeChunkSize(batchableSets, BATCHABLE_MIN_PER_CHUNK);

    for (const batchableChunk of batchableChunks) {
      const allSets: WorkRequestSet[] = [];
      for (const {sets} of batchableChunk) {
        for (const set of sets) {
          allSets.push(set);
        }
      }

      // Attempt to verify multiple sets at once
      batchOperations.push(
        asyncVerifySignatureSetsMaybeBatch(allSets)
          .then((isValid) => {
            if (isValid) {
              // The entire batch is valid, return success to all
              for (const {idx, sets} of batchableChunk) {
                batchSigsSuccess += sets.length;
                results[idx] = {code: WorkResultCode.success, result: isValid};
              }
            } else {
              batchRetries++;
              // Re-verify all sigs
              nonBatchableSets.push(...batchableChunk);
            }
          })
          .catch(() => {
            // TODO: Ignore this error expecting that the same error will happen when re-verifying the set individually
            //       It's not ideal but '@chainsafe/blst' may throw errors on some conditions
            batchRetries++;
            // Re-verify all sigs
            nonBatchableSets.push(...batchableChunk);
          })
      );
    }
  }
  await Promise.all(batchOperations);

  await Promise.all(
    nonBatchableSets.map(({idx, sets}) =>
      asyncVerifySignatureSetsMaybeBatch(sets)
        .then((isValid) => {
          results[idx] = {code: WorkResultCode.success, result: isValid};
        })
        .catch((e) => {
          results[idx] = {code: WorkResultCode.error, error: e as Error};
        })
    )
  );

  const [workerEndSec, workerEndNs] = process.hrtime();

  return {
    batchRetries,
    batchSigsSuccess,
    workerStartTime: [startSec, startNs],
    workerEndTime: [workerEndSec, workerEndNs],
    results,
  };
}
