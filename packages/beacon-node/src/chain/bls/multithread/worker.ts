import worker from "node:worker_threads";
import {PublicKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {expose} from "@chainsafe/threads/worker";
import {SignatureSetDeserialized, verifySignatureSetsMaybeBatch} from "../maybeBatch.js";
import {BlsWorkReq, BlsWorkResult, SerializedSet, WorkResult, WorkResultCode, WorkerData} from "./types.js";
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
  const results: WorkResult<boolean>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  // If there are multiple batchable sets attempt batch verification with them
  const batchableSets: {idx: number; sets: SignatureSetDeserialized[]}[] = [];
  const nonBatchableSets: {idx: number; sets: SignatureSetDeserialized[]}[] = [];

  // Split sets between batchable and non-batchable preserving their original index in the req array
  for (let i = 0; i < workReqArr.length; i++) {
    const workReq = workReqArr[i];

    let sets: SignatureSetDeserialized[];
    try {
      sets = workReq.sets.map(resolveSet);
    } catch (e) {
      // An unknown validator index must fail only this request, never the
      // batch it would have joined.
      results[i] = {code: WorkResultCode.error, error: e as Error};
      continue;
    }

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
      const allSets: SignatureSetDeserialized[] = [];
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

/**
 * Resolve a shipped descriptor to a verifiable set. Indexed and aggregate
 * sets read the process-wide native pubkey cache (populated by the main
 * thread; the native singleton is shared across worker threads). Throws on
 * an unknown validator index — callers must scope that to one request.
 */
function resolveSet(set: SerializedSet): SignatureSetDeserialized {
  switch (set.type) {
    case "single":
      return {publicKey: PublicKey.fromBytes(set.publicKey), message: set.message, signature: set.signature};
    case "indexed":
      return {publicKey: pubkeyCache.getOrThrow(set.index), message: set.message, signature: set.signature};
    case "aggregate":
      return {publicKey: pubkeyCache.aggregate(set.indices), message: set.message, signature: set.signature};
  }
}
