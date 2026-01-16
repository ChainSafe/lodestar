import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {fulu} from "@lodestar/types";
import {kzg} from "../../util/kzg.js";

/**
 * Result of validating a partial data column received via partial messages.
 */
export enum PartialColumnValidationResult {
  ACCEPT = "ACCEPT",
  REJECT_INVALID_INDEX = "REJECT_INVALID_INDEX",
  REJECT_INVALID_KZG_PROOF = "REJECT_INVALID_KZG_PROOF",
  REJECT_MALFORMED = "REJECT_MALFORMED",
}

/**
 * Validates a partial data column received via partial messages.
 *
 * This is a lighter validation than full gossip validation since partial columns
 * are received from mesh peers and don't require all the same checks (e.g., slot
 * timing, proposer signature, finalization). The key validations are:
 * 1. Column index is within valid range
 * 2. Data structure is well-formed
 * 3. KZG proofs are valid for the cells in this column
 */
export async function validatePartialDataColumn(
  column: fulu.DataColumnSidecar
): Promise<PartialColumnValidationResult> {
  // 1. Validate column index is within valid range
  if (column.index >= NUMBER_OF_COLUMNS) {
    return PartialColumnValidationResult.REJECT_INVALID_INDEX;
  }

  // 2. Validate data structure is well-formed
  if (column.column.length === 0) {
    return PartialColumnValidationResult.REJECT_MALFORMED;
  }

  if (column.kzgCommitments.length === 0) {
    return PartialColumnValidationResult.REJECT_MALFORMED;
  }

  // Column cells must match kzgCommitments and kzgProofs length
  if (column.column.length !== column.kzgCommitments.length) {
    return PartialColumnValidationResult.REJECT_MALFORMED;
  }

  if (column.column.length !== column.kzgProofs.length) {
    return PartialColumnValidationResult.REJECT_MALFORMED;
  }

  // 3. Validate KZG proofs for cells in this column
  try {
    // Build arrays for batch verification
    // Each cell in the column corresponds to a blob, so we use the same column index for all
    const cellIndices = Array.from({length: column.column.length}, () => column.index);

    const valid = await kzg.asyncVerifyCellKzgProofBatch(
      column.kzgCommitments,
      cellIndices,
      column.column,
      column.kzgProofs
    );

    if (!valid) {
      return PartialColumnValidationResult.REJECT_INVALID_KZG_PROOF;
    }
  } catch {
    return PartialColumnValidationResult.REJECT_INVALID_KZG_PROOF;
  }

  return PartialColumnValidationResult.ACCEPT;
}
