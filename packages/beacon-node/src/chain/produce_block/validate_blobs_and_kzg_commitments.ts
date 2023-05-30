import {verifyKzgCommitmentsAgainstTransactions} from "@lodestar/state-transition";
import {allForks, deneb} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {BlobsBundle} from "../../execution/index.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {ckzg} from "../../util/kzg.js";

/**
 * Optionally sanity-check that the KZG commitments match the versioned hashes in the transactions
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/validator.md#blob-kzg-commitments
 */
export function validateBlobsAndKzgCommitments(payload: allForks.ExecutionPayload, blobsBundle: BlobsBundle): void {
  verifyKzgCommitmentsAgainstTransactions(payload.transactions, blobsBundle.commitments);

  // Optionally sanity-check that the KZG commitments match the blobs (as produced by the execution engine)
  if (blobsBundle.blobs.length !== blobsBundle.commitments.length) {
    throw Error(
      `Blobs bundle blobs len ${blobsBundle.blobs.length} != commitments len ${blobsBundle.commitments.length}`
    );
  }

  for (let i = 0; i < blobsBundle.blobs.length; i++) {
    const kzg = ckzg.blobToKzgCommitment(blobsBundle.blobs[i]) as deneb.KZGCommitment;
    if (!byteArrayEquals(kzg, blobsBundle.commitments[i])) {
      throw Error(`Wrong KZG[${i}] ${toHex(blobsBundle.commitments[i])} expected ${toHex(kzg)}`);
    }
  }
}
