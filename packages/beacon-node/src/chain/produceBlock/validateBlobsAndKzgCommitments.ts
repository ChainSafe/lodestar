import {ExecutionPayload} from "@lodestar/types";
import {BlobsBundle} from "../../execution/index.js";

/**
 * Optionally sanity-check that the KZG commitments match the versioned hashes in the transactions
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/validator.md#blob-kzg-commitments
 */

export function validateBlobsAndKzgCommitments(_payload: ExecutionPayload, blobsBundle: BlobsBundle): void {
  // sanity-check that the KZG commitments match the blobs (as produced by the execution engine)
  if (blobsBundle.blobs.length !== blobsBundle.commitments.length) {
    throw Error(
      `Blobs bundle blobs len ${blobsBundle.blobs.length} != commitments len ${blobsBundle.commitments.length}`
    );
  }
}
