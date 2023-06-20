import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {Logger} from "@lodestar/utils";
import {
  verifySignatureSetsMaybeBatch,
  SignatureSetDeserialized,
  SignatureSetSerialized,
  asyncVerifySignatureSetsMaybeBatch,
} from "../maybeBatch.js";
import {BlsWorkReq, WorkResult, WorkResultCode, SerializedSet, BlsWorkResult} from "./types.js";
import {chunkifyMaximizeChunkSize} from "./utils.js";

/**
 * Work request potentially has batchable and non-batchable sets. Batchable sets may be
 * individual attestations or aggregates with proofs. There is an optimization to put a
 * group of unrelated signatures together into a batch verification to reduce the cost.
 * Only if the entire batch is invalid do the sets need to be re-verified individually as
 * a non-batchable group of sets.
 */

/**
 * Split batchable sets in chunks of minimum size 16.
 * Batch verify 16 has an aprox cost of 16+1. For 32 it's 32+1. After ~16 the additional savings are not significant.
 * However, if a sig is invalid the whole batch has to be re-verified. So it's important to keep this number low.
 * In normal network conditions almost all signatures received by the node are correct.
 * After observing metrics this number can be reviewed
 */
const BATCHABLE_MIN_PER_CHUNK = 16;

/**
 * Uses worker thread to verify
 */
export function verifyManySignatureSets(workerId: number, workReqArr: BlsWorkReq[]): BlsWorkResult {
  const startNs = process.hrtime.bigint();
  const results: WorkResult<boolean>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  // If there are multiple batchable sets attempt batch verification with them
  const batchableSets: {idx: number; sets: SignatureSetDeserialized[]}[] = [];
  const nonBatchableSets: {idx: number; sets: SignatureSetDeserialized[]}[] = [];

  // Split sets between batchable and non-batchable preserving their original index in the req array
  for (let i = 0; i < workReqArr.length; i++) {
    const workReq = workReqArr[i];
    const sets = workReq.sets.map(deserializeSwigSet);

    if (workReq.opts.batchable) {
      batchableSets.push({idx: i, sets});
    } else {
      nonBatchableSets.push({idx: i, sets});
    }
  }

  if (batchableSets.length > 0) {
    // Split batchable into chunks of max size ~ 32 to minimize cost if a sig is wrong
    const batchableChunks = chunkifyMaximizeChunkSize(batchableSets, BATCHABLE_MIN_PER_CHUNK);

    for (const batchableChunk of batchableChunks) {
      // flatten all sets into a single array for batch verification
      const allSets: SignatureSetDeserialized[] = [];
      for (const {sets} of batchableChunk) {
        // TODO: speed test in perf for potential switch to allSets.push(...sets);
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
          // Re-verify all sigs individually
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

  return {
    workerId,
    batchRetries,
    batchSigsSuccess,
    workStartNs: startNs,
    workEndNs: process.hrtime.bigint(),
    results,
  };
}

/**
 * Same as verifyManySignatureSets but uses libuv thread pool instead of worker threads
 */
export async function asyncVerifyManySignatureSets(logger: Logger, workReqArr: BlsWorkReq[]): Promise<BlsWorkResult> {
  const workStartNs = process.hrtime.bigint();
  const results: WorkResult<boolean>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  // If there are multiple batchable sets attempt batch verification with them
  const batchableSets: {idx: number; sets: SignatureSetSerialized[]}[] = [];
  const nonBatchableSets: {idx: number; sets: SignatureSetSerialized[]}[] = [];

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
      // flatten all sets into a single array for batch verification
      const allSets: SignatureSetSerialized[] = [];
      for (const {sets} of batchableChunk) {
        // TODO: speed test in perf for potential switch to allSets.push(...sets);
        for (const set of sets) {
          allSets.push(set);
        }
      }

      try {
        // Attempt to verify multiple sets at once
        logger.debug(`Attempting asyncVerifySignatureSetsMaybeBatch of ${allSets.length} signature sets`);
        const isValid = await asyncVerifySignatureSetsMaybeBatch(logger, allSets);
        logger.debug(`Batch verification returned: ${isValid}`);

        if (isValid) {
          // The entire batch is valid, return success to all
          for (const {idx, sets} of batchableChunk) {
            batchSigsSuccess += sets.length;
            results[idx] = {code: WorkResultCode.success, result: isValid};
          }
        } else {
          batchRetries++;
          // Re-verify all sigs individually
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

  await Promise.all(
    nonBatchableSets.map(({idx, sets}) =>
      asyncVerifySignatureSetsMaybeBatch(logger, sets)
        .then((isValid) => {
          results[idx] = {code: WorkResultCode.success, result: isValid};
        })
        .catch((e) => {
          results[idx] = {code: WorkResultCode.error, error: e as Error};
        })
    )
  );

  return {
    batchRetries,
    batchSigsSuccess,
    workStartNs,
    workEndNs: process.hrtime.bigint(),
    results,
  };
}

function deserializeSwigSet(set: SerializedSet): SignatureSetDeserialized {
  return {
    publicKey: bls.PublicKey.fromBytes(set.publicKey, CoordType.affine),
    message: set.message,
    signature: set.signature,
  };
}
