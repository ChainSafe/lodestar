import {CELLS_PER_EXT_BLOB} from "@lodestar/params";
import {deneb, fulu} from "@lodestar/types";
import {kzg} from "../../util/kzg.js";

/**
 * Optionally sanity-check that the KZG commitments match the versioned hashes in the transactions
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/validator.md#blob-kzg-commitments
 */
export async function validateBlobsAndKzgCommitments(
  commitments: deneb.KZGCommitment[],
  proofs: deneb.KZGProof[],
  blobs: deneb.Blobs
): Promise<void> {
  if (blobs.length !== commitments.length) {
    throw Error(`Blobs bundle blobs len ${blobs.length} != commitments len ${commitments.length}`);
  }

  if (proofs.length !== blobs.length) {
    throw new Error(`Invalid proofs length for BlobsBundleV1 format: expected ${blobs.length}, got ${proofs.length}`);
  }

  if (!(await kzg.asyncVerifyBlobKzgProofBatch(blobs, commitments, proofs))) {
    throw new Error("Error in verifyBlobKzgProofBatch");
  }
}

/**
 * Optionally sanity-check that the KZG commitments match the versioned hashes in the transactions
 */
export async function validateCellsAndKzgCommitments(
  commitments: deneb.KZGCommitment[],
  proofs: fulu.KZGProof[],
  cells: fulu.Cell[][]
): Promise<void> {
  if (cells.length !== commitments.length) {
    throw Error(`Blobs bundle cells len ${cells.length} != commitments len ${commitments.length}`);
  }

  const expectedProofsLength = cells.length * CELLS_PER_EXT_BLOB;
  if (proofs.length !== expectedProofsLength) {
    throw Error(
      `Invalid proofs length for BlobsBundleV2 format: expected ${expectedProofsLength}, got ${proofs.length}`
    );
  }

  const commitmentBytes = commitments.flatMap((commitment) => Array(CELLS_PER_EXT_BLOB).fill(commitment));
  const cellIndices = Array.from({length: cells.length}).flatMap(() =>
    Array.from({length: CELLS_PER_EXT_BLOB}, (_, i) => i)
  );

  if (!(await kzg.asyncVerifyCellKzgProofBatch(commitmentBytes, cellIndices, cells.flat(), proofs.flat()))) {
    throw new Error("Error in verifyCellKzgProofBatch");
  }
}
