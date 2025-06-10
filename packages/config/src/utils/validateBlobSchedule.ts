import {MAX_BLOB_COMMITMENTS_PER_BLOCK} from "@lodestar/params";
import {BlobSchedule} from "../chainConfig/types.js";

export function validateBlobSchedule(blobSchedule: BlobSchedule): void {
  if (blobSchedule.length === 0) {
    return;
  }

  let previousEpoch: number | undefined;

  blobSchedule.forEach((entry, i) => {
    if (previousEpoch !== undefined) {
      if (entry.EPOCH < previousEpoch) {
        throw Error(
          `Blob schedule entries must be in ascending order by EPOCH, ${entry.EPOCH} < ${previousEpoch} at index ${i}`
        );
      }
      if (entry.EPOCH === previousEpoch) {
        throw Error(`Duplicate entries found for epoch ${entry.EPOCH} at ${i - 1} and ${i}`);
      }
    }
    if (entry.MAX_BLOBS_PER_BLOCK > MAX_BLOB_COMMITMENTS_PER_BLOCK) {
      throw Error(
        `Max blobs value exceeds error at ${i}. Value ${entry.MAX_BLOBS_PER_BLOCK} limit ${MAX_BLOB_COMMITMENTS_PER_BLOCK}`
      );
    }

    previousEpoch = entry.EPOCH;
  });
}
