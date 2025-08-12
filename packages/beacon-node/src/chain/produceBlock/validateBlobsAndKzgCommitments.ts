import {CELLS_PER_EXT_BLOB, ForkName, ForkSeq, isForkPostDeneb} from "@lodestar/params";
import {ExecutionPayload, fulu} from "@lodestar/types";
import {BlobsBundle} from "../../execution/index.js";
import {kzg} from "../../util/kzg.js";

/**
 * Optionally sanity-check that the KZG commitments match the versioned hashes in the transactions
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/validator.md#blob-kzg-commitments
 */

export async function validateBlobsAndKzgCommitments(
  fork: ForkName,
  _payload: ExecutionPayload,
  blobsBundle: BlobsBundle,
  cells?: fulu.Cell[][]
): Promise<void> {
  if (!isForkPostDeneb(fork)) {
    throw Error(`validateBlobsAndKzgCommitments called with pre-deneb fork=${fork}`);
  }

  if (blobsBundle.blobs.length !== blobsBundle.commitments.length) {
    throw Error(
      `Blobs bundle blobs len ${blobsBundle.blobs.length} != commitments len ${blobsBundle.commitments.length}`
    );
  }

  if (ForkSeq[fork] < ForkSeq.fulu) {
    if (blobsBundle.proofs.length !== blobsBundle.blobs.length) {
      throw new Error(
        `Invalid proofs length for BlobsBundleV1 format: expected ${blobsBundle.blobs.length}, got ${blobsBundle.proofs.length}`
      );
    }

    if (!(await kzg.asyncVerifyBlobKzgProofBatch(blobsBundle.blobs, blobsBundle.commitments, blobsBundle.proofs))) {
      throw new Error("Error in verifyBlobKzgProofBatch");
    }

    return;
  }

  if (!cells) {
    throw Error(`Missing cells for post-fulu fork=${fork}`);
  }

  const expectedProofsLength = blobsBundle.blobs.length * CELLS_PER_EXT_BLOB;
  if (blobsBundle.proofs.length !== expectedProofsLength) {
    throw Error(
      `Invalid proofs length for BlobsBundleV2 format: expected ${expectedProofsLength}, got ${blobsBundle.proofs.length}`
    );
  }

  const commitmentBytes = blobsBundle.commitments.flatMap((commitment) => Array(CELLS_PER_EXT_BLOB).fill(commitment));
  const cellIndices = Array.from({length: blobsBundle.blobs.length}).flatMap(() =>
    Array.from({length: CELLS_PER_EXT_BLOB}, (_, i) => i)
  );
  const proofBytes = blobsBundle.proofs.flat();

  if (!(await kzg.asyncVerifyCellKzgProofBatch(commitmentBytes, cellIndices, cells.flat(), proofBytes))) {
    throw new Error("Error in verifyCellKzgProofBatch");
  }
}
