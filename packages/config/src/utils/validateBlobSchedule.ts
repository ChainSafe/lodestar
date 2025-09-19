import {MAX_BLOB_COMMITMENTS_PER_BLOCK} from "@lodestar/params";
import {BlobSchedule} from "../chainConfig/types.js";

export function validateBlobSchedule(blobSchedule: BlobSchedule): void {
  if (blobSchedule.length === 0) {
    return;
  }

  let previousEpoch: number | undefined;

  for (const [i, entry] of blobSchedule.entries()) {
    if (previousEpoch !== undefined) {
      if (entry.EPOCH < previousEpoch) {
        throw Error(
          `Invalid BLOB_SCHEDULE expected entries to be sorted by EPOCH in ascending order, ${entry.EPOCH} < ${previousEpoch} at index ${i}`
        );
      }
      if (entry.EPOCH === previousEpoch) {
        throw Error(
          `Invalid BLOB_SCHEDULE[${i}] entry with the same epoch value ${entry.EPOCH} as previous BLOB_SCHEDULE[${i - 1}] entry`
        );
      }
    }
    if (entry.MAX_BLOBS_PER_BLOCK > MAX_BLOB_COMMITMENTS_PER_BLOCK) {
      throw Error(
        `Invalid BLOB_SCHEDULE[${i}].MAX_BLOBS_PER_BLOCK value ${entry.MAX_BLOBS_PER_BLOCK} exceeds limit ${MAX_BLOB_COMMITMENTS_PER_BLOCK}`
      );
    }

    previousEpoch = entry.EPOCH;
  }
}
