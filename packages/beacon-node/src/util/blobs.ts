import {digest as sha256Digest} from "@chainsafe/as-sha256";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {ChainForkConfig} from "@lodestar/config";
import {
  BYTES_PER_CELL,
  BYTES_PER_FIELD_ELEMENT,
  CELLS_PER_EXT_BLOB,
  FIELD_ELEMENTS_PER_BLOB,
  ForkAll,
  ForkName,
  KZG_COMMITMENTS_GINDEX,
  KZG_COMMITMENT_GINDEX0,
  NUMBER_OF_COLUMNS,
  VERSIONED_HASH_VERSION_KZG,
} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {BeaconBlockBody, SSZTypesFor, SignedBeaconBlock, deneb, fulu, ssz} from "@lodestar/types";
import {kzg} from "./kzg.js";

type VersionHash = Uint8Array;

export function kzgCommitmentToVersionedHash(kzgCommitment: deneb.KZGCommitment): VersionHash {
  const hash = sha256Digest(kzgCommitment);
  // Equivalent to `VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]`
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}

export function computeInclusionProof(
  fork: ForkName,
  body: BeaconBlockBody,
  index: number
): deneb.KzgCommitmentInclusionProof {
  const bodyView = (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkAll, "BeaconBlockBody">).toView(body);
  const commitmentGindex = KZG_COMMITMENT_GINDEX0 + index;
  return new Tree(bodyView.node).getSingleProof(BigInt(commitmentGindex));
}

export function computeKzgCommitmentsInclusionProof(
  fork: ForkName,
  body: BeaconBlockBody
): fulu.KzgCommitmentsInclusionProof {
  const bodyView = (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkAll, "BeaconBlockBody">).toView(body);
  return new Tree(bodyView.node).getSingleProof(BigInt(KZG_COMMITMENTS_GINDEX));
}

export function computeBlobSidecars(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock,
  contents: deneb.Contents & {kzgCommitmentInclusionProofs?: deneb.KzgCommitmentInclusionProof[]}
): deneb.BlobSidecars {
  const blobKzgCommitments = (signedBlock as deneb.SignedBeaconBlock).message.body.blobKzgCommitments;
  if (blobKzgCommitments === undefined) {
    throw Error("Invalid block with missing blobKzgCommitments for computeBlobSidecars");
  }

  const signedBlockHeader = signedBlockToSignedHeader(config, signedBlock);
  const fork = config.getForkName(signedBlockHeader.message.slot);

  return blobKzgCommitments.map((kzgCommitment, index) => {
    const blob = contents.blobs[index];
    const kzgProof = contents.kzgProofs[index];
    const kzgCommitmentInclusionProof =
      contents.kzgCommitmentInclusionProofs?.[index] ?? computeInclusionProof(fork, signedBlock.message.body, index);

    return {index, blob, kzgCommitment, kzgProof, signedBlockHeader, kzgCommitmentInclusionProof};
  });
}

/**
 * Turns a SignedBeaconBlock and an array of Blobs from a given slot into an array of
 * DataColumnSidecars that are ready to be served by gossip and req/resp.
 *
 * Implementation of get_data_column_sidecars
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/_features/eip7594/das-core.md#get_data_column_sidecars
 */
export function computeDataColumnSidecars(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock,
  contents: fulu.Contents & {kzgCommitmentsInclusionProof?: fulu.KzgCommitmentsInclusionProof; cells?: fulu.Cell[][]}
): fulu.DataColumnSidecars {
  const blobKzgCommitments = (signedBlock as deneb.SignedBeaconBlock).message.body.blobKzgCommitments;
  if (blobKzgCommitments === undefined) {
    throw Error("Invalid block with missing blobKzgCommitments for computeBlobSidecars");
  }
  if (blobKzgCommitments.length === 0) {
    return [];
  }
  const fork = config.getForkName(signedBlock.message.slot);
  const signedBlockHeader = signedBlockToSignedHeader(config, signedBlock);
  const kzgCommitmentsInclusionProof =
    contents.kzgCommitmentsInclusionProof ?? computeKzgCommitmentsInclusionProof(fork, signedBlock.message.body);
  const {blobs, kzgProofs} = contents;
  const cellsAndProofs = Array.from({length: blobs.length}, (_, rowNumber) => {
    const cells = contents.cells?.[rowNumber] ?? kzg.computeCells(blobs[rowNumber]);
    const proofs = kzgProofs.slice(rowNumber * NUMBER_OF_COLUMNS, (rowNumber + 1) * NUMBER_OF_COLUMNS);
    return {cells, proofs};
  });

  return Array.from({length: NUMBER_OF_COLUMNS}, (_, columnIndex) => {
    // columnIndex'th column
    const column = Array.from({length: blobs.length}, (_, rowNumber) => cellsAndProofs[rowNumber].cells[columnIndex]);
    const kzgProofs = Array.from(
      {length: blobs.length},
      (_, rowNumber) => cellsAndProofs[rowNumber].proofs[columnIndex]
    );
    return {
      index: columnIndex,
      column,
      kzgCommitments: blobKzgCommitments,
      kzgProofs,
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    };
  });
}

/**
 * If the node obtains 50%+ of all the columns, it SHOULD reconstruct the full data matrix via the recover_matrix helper
 * See https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#recover_matrix
 */
export async function recoverDataColumnSidecars(
  partialSidecars: Map<number, fulu.DataColumnSidecar>
): Promise<fulu.DataColumnSidecars | null> {
  const columnCount = partialSidecars.size;
  if (columnCount < NUMBER_OF_COLUMNS / 2) {
    // We don't have enough columns to recover
    return null;
  }

  if (columnCount === NUMBER_OF_COLUMNS) {
    // full columns, no need to recover
    return Array.from(partialSidecars.values());
  }

  const firstDataColumn = partialSidecars.values().next().value;
  if (firstDataColumn == null) {
    // should not happen because we check the size of the cache before this
    throw new Error("No data column found in cache to recover from");
  }
  const blobCount = firstDataColumn.kzgCommitments.length;

  const fullColumns: Array<Uint8Array[]> = Array.from(
    {length: NUMBER_OF_COLUMNS},
    () => new Array<Uint8Array>(blobCount)
  );
  const blobProofs: Array<Uint8Array[]> = Array.from({length: blobCount});
  // https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#recover_matrix
  const cellsAndProofs = await Promise.all(
    blobProofs.map((_, blobIndex) => {
      const cellIndices: number[] = [];
      const cells: Uint8Array[] = [];
      for (const [columnIndex, dataColumn] of partialSidecars.entries()) {
        cellIndices.push(columnIndex);
        cells.push(dataColumn.column[blobIndex]);
      }
      // recovered cells and proofs are of the same row/blob, their length should be NUMBER_OF_COLUMNS
      return kzg.asyncRecoverCellsAndKzgProofs(cellIndices, cells);
    })
  );

  for (let blobIndex = 0; blobIndex < blobCount; blobIndex++) {
    const recoveredCells = cellsAndProofs[blobIndex].cells;
    blobProofs[blobIndex] = cellsAndProofs[blobIndex].proofs;
    for (let columnIndex = 0; columnIndex < NUMBER_OF_COLUMNS; columnIndex++) {
      fullColumns[columnIndex][blobIndex] = recoveredCells[columnIndex];
    }
  }

  const result: fulu.DataColumnSidecars = new Array(NUMBER_OF_COLUMNS);

  for (let columnIndex = 0; columnIndex < NUMBER_OF_COLUMNS; columnIndex++) {
    let sidecar = partialSidecars.get(columnIndex);
    if (sidecar) {
      // We already have this column
      result[columnIndex] = sidecar;
      continue;
    }

    sidecar = {
      index: columnIndex,
      column: fullColumns[columnIndex],
      kzgCommitments: firstDataColumn.kzgCommitments,
      kzgProofs: Array.from({length: blobCount}, (_, rowIndex) => blobProofs[rowIndex][columnIndex]),
      signedBlockHeader: firstDataColumn.signedBlockHeader,
      kzgCommitmentsInclusionProof: firstDataColumn.kzgCommitmentsInclusionProof,
    };
    result[columnIndex] = sidecar;
  }

  return result;
}

/**
 * Reconstruct blobs from a set of data columns, at least 50%+ of all the columns
 * must be provided to allow to reconstruct the full data matrix
 */
export async function reconstructBlobs(sidecars: fulu.DataColumnSidecars): Promise<deneb.Blobs> {
  if (sidecars.length < NUMBER_OF_COLUMNS / 2) {
    throw Error(
      `Expected at least ${NUMBER_OF_COLUMNS / 2} data columns to reconstruct blobs, received ${sidecars.length}`
    );
  }

  let fullSidecars: fulu.DataColumnSidecars;

  if (sidecars.length === NUMBER_OF_COLUMNS) {
    // Full columns, no need to recover
    fullSidecars = sidecars;
  } else {
    const sidecarsByIndex = new Map<number, fulu.DataColumnSidecar>(sidecars.map((sc) => [sc.index, sc]));
    const recoveredSidecars = await recoverDataColumnSidecars(sidecarsByIndex);
    if (recoveredSidecars === null) {
      // Should not happen because we check the column count above
      throw Error("Failed to reconstruct the full data matrix");
    }
    fullSidecars = recoveredSidecars;
  }

  const blobCount = fullSidecars[0].column.length;
  const blobs: deneb.Blobs = new Array(blobCount);

  const ordered = fullSidecars.slice().sort((a, b) => a.index - b.index);
  for (let row = 0; row < blobCount; row++) {
    // 128 cells that make up one "extended blob" row
    const cells = ordered.map((col) => col.column[row]);
    blobs[row] = cellsToBlob(cells);
  }

  return blobs;
}

/**
 * Concatenate the systematic half (columns 0‑63) of a row of cells into
 * the original 131072 byte blob. The parity half (64‑127) is ignored as
 * it is only needed for erasure‑coding recovery when columns are missing.
 */
function cellsToBlob(cells: fulu.Cell[]): deneb.Blob {
  if (cells.length !== CELLS_PER_EXT_BLOB) {
    throw Error(`Expected ${CELLS_PER_EXT_BLOB} cells to reconstruct blob, received ${cells.length}`);
  }

  const blob = new Uint8Array(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB);

  // Only the first 64 cells hold the original bytes
  for (let i = 0; i < CELLS_PER_EXT_BLOB / 2; i++) {
    const cell = cells[i];
    if (cell.length !== BYTES_PER_CELL) {
      throw Error(`Cell ${i} has incorrect byte size ${cell.length} != ${BYTES_PER_CELL}`);
    }

    blob.set(cell, i * BYTES_PER_CELL);
  }

  return blob;
}
