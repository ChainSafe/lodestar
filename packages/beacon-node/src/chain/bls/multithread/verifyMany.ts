import {type BlsSignatureSet} from "@chainsafe/lodestar-z/bls-verifier";
import {BlsWorkReq, BlsWorkResult, JobQueueItemType, WorkResult, WorkResultCode} from "./types.js";
import {chunkifyMaximizeChunkSize} from "./utils.js";

/**
 * Keep invalid-batch fallback groups small. Above roughly 16 requests the
 * extra pairing savings are minor while retry cost continues to grow.
 */
const BATCHABLE_MIN_PER_CHUNK = 16;

export type NativeBlsVerifier = {
  verify(sets: BlsSignatureSet[], critical: boolean): Promise<boolean>;
  verifySameMessage(
    sets: {index: number; signature: Uint8Array}[],
    message: Uint8Array,
    critical: boolean
  ): Promise<boolean[]>;
};

/**
 * Preserve request-level results while batching compatible general jobs. Each
 * native call is independently scheduled, so same-message work and fallback
 * do not block unrelated requests in this group.
 */
export async function verifyManySignatureSets(
  workReqs: BlsWorkReq[],
  verifier: NativeBlsVerifier
): Promise<BlsWorkResult> {
  const results: (WorkResult<boolean[]> | undefined)[] = new Array(workReqs.length);
  const batchable: {index: number; req: Extract<BlsWorkReq, {type: JobQueueItemType.default}>}[] = [];
  const tasks: Promise<void>[] = [];
  let batchRetries = 0;
  let batchSigsSuccess = 0;

  for (const [index, req] of workReqs.entries()) {
    switch (req.type) {
      case JobQueueItemType.default:
        if (req.opts.batchable) {
          batchable.push({index, req});
        } else {
          tasks.push(verifyDefault(index, req.sets, req.opts.priority === true, results, verifier));
        }
        break;

      case JobQueueItemType.sameMessage:
        tasks.push(
          verifier
            .verifySameMessage(req.sets, req.message, req.opts.priority === true)
            .then((result) => {
              results[index] = {code: WorkResultCode.success, result};
            })
            .catch((error: unknown) => {
              results[index] = {code: WorkResultCode.error, error: asError(error)};
            })
        );
        break;
    }
  }

  if (batchable.length > 0) {
    for (const chunk of chunkifyMaximizeChunkSize(batchable, BATCHABLE_MIN_PER_CHUNK)) {
      tasks.push(
        verifyBatchableChunk(chunk, results, verifier).then((batchResult) => {
          batchRetries += batchResult.retries;
          batchSigsSuccess += batchResult.sigsSuccess;
        })
      );
    }
  }

  await Promise.all(tasks);
  return {batchRetries, batchSigsSuccess, results};
}

async function verifyBatchableChunk(
  chunk: {index: number; req: Extract<BlsWorkReq, {type: JobQueueItemType.default}>}[],
  results: (WorkResult<boolean[]> | undefined)[],
  verifier: NativeBlsVerifier
): Promise<{retries: number; sigsSuccess: number}> {
  const allSets = chunk.flatMap(({req}) => req.sets);
  const critical = chunk.some(({req}) => req.opts.priority === true);

  try {
    if (await verifier.verify(allSets, critical)) {
      let sigsSuccess = 0;
      for (const {index, req} of chunk) {
        sigsSuccess += req.sets.length;
        results[index] = {code: WorkResultCode.success, result: [true]};
      }
      return {retries: 0, sigsSuccess};
    }
  } catch {
    // A combined cache or interface error does not identify the original
    // request that owns the bad input, so retry at the request boundary.
  }

  await Promise.all(
    chunk.map(({index, req}) => verifyDefault(index, req.sets, req.opts.priority === true, results, verifier))
  );
  return {retries: 1, sigsSuccess: 0};
}

async function verifyDefault(
  index: number,
  sets: BlsSignatureSet[],
  critical: boolean,
  results: (WorkResult<boolean[]> | undefined)[],
  verifier: NativeBlsVerifier
): Promise<void> {
  try {
    results[index] = {code: WorkResultCode.success, result: [await verifier.verify(sets, critical)]};
  } catch (error) {
    results[index] = {code: WorkResultCode.error, error: asError(error)};
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : Error(String(error));
}
