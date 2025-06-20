import {ByteVectorType, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RespStatus, ResponseError} from "@lodestar/reqresp";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {ColumnIndex, SignedBeaconBlock, deneb, fulu, ssz} from "@lodestar/types";
import {computeKzgCommitmentsInclusionProof} from "./blobs.js";
import {kzg} from "./rustKzg.js";

// NOTE: If you change the order of these fields or add/remove anything you must
//       update the byte offsets below to match the container.
export const dataColumnSidecarsDbWrapperSsz = new ContainerType(
  {
    blockRoot: ssz.Root,
    slot: ssz.Slot,
    dataColumnsLen: ssz.Uint8,
    dataColumnsSize: ssz.UintNum64,
    // // each byte[i] tells what index (1 based) the column i is stored, 0 means not custodied
    // max value to represent will be 128 which can be represented in a byte
    dataColumnsIndex: new ByteVectorType(NUMBER_OF_COLUMNS),
    dataColumnSidecars: ssz.fulu.DataColumnSidecars,
  },
  {typeName: "DataColumnSidecarsWrapper", jsonCase: "eth2"}
);

export type DataColumnSidecarsDbWrapper = ValueOf<typeof dataColumnSidecarsDbWrapperSsz>;

export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_BLOCK_ROOT = 0;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_SLOT = 32;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_NUM_OF_COLUMNS = 40;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_COLUMN_SIZE = 41;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_CUSTODY_INDEX = 49;
export const SSZ_OFFSET_BYTES_FOR_LIST_TYPE = 4;
// dataColumnSidecars is a variable length container so there is a byte offset to the beginning
// of the container before the container itself.
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_TO_FIRST_SIDECAR =
  COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_CUSTODY_INDEX + NUMBER_OF_COLUMNS + SSZ_OFFSET_BYTES_FOR_LIST_TYPE;

export function parseWrappedColumnSidecars(wrapped: Uint8Array): {
  numberOfColumns: number;
  columnSizeInBytes: number;
  custodyIndex: Uint8Array;
  serializedColumnSidecars: Uint8Array;
} {
  const numberOfColumns = ssz.Uint8.deserialize(
    wrapped.subarray(COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_NUM_OF_COLUMNS, COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_COLUMN_SIZE)
  );

  const columnSizeInBytes = ssz.UintNum64.deserialize(
    wrapped.slice(COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_COLUMN_SIZE, COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_CUSTODY_INDEX)
  );

  const custodyIndex = wrapped.slice(
    COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_CUSTODY_INDEX,
    COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_CUSTODY_INDEX + NUMBER_OF_COLUMNS
  );

  // each dataColumnSidecar element int he dataColumnSidecars list is itself a variable length
  // container so there is an offset for each element at the beginning of the container. need
  // to slice those off to get to the actual elements
  const serializedColumnSidecars = wrapped.slice(
    COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_TO_FIRST_SIDECAR + SSZ_OFFSET_BYTES_FOR_LIST_TYPE * numberOfColumns
  );

  return {
    numberOfColumns,
    columnSizeInBytes,
    custodyIndex,
    serializedColumnSidecars,
  };
}

// TOOO(fulu): will be implemented in writeBlockInputToDb.ts
// export function buildDataColumnSidecarsDbWrapper(
//   custodyConfig: CustodyConfig,
//   block: SignedBeaconBlock,
//   blockRoot: Uint8Array,
//   dataColumnSidecars: fulu.DataColumnSidecars
// ): DataColumnSidecarsDbWrapper {
//   const commitmentsLength = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;

//   let dataColumnsLen: number;
//   let dataColumnsIndex: Uint8Array;
//   if (commitmentsLength === 0) {
//     dataColumnsLen = 0;
//     dataColumnsIndex = new Uint8Array(NUMBER_OF_COLUMNS);
//   } else {
//     dataColumnsLen = custodyConfig.custodyColumns.length;
//     dataColumnsIndex = custodyConfig.custodyColumnsIndex;
//   }

//   const dataColumnsSize =
//     ssz.fulu.DataColumnSidecar.minSize +
//     commitmentsLength * (ssz.fulu.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);

//   return {
//     slot: block.message.slot,
//     blockRoot,
//     dataColumnsLen,
//     dataColumnsSize,
//     dataColumnsIndex,
//     dataColumnSidecars,
//   };
// }

/**
 * CustodyIndex is a Unit8Array for representing which ColumnIndex is stored in the db and at which
 * 0-indexed array position the column can be found in the stored data.  The Custody index is structured
 * such that each byte is either 0 for non-custody or a 1-indexed array position for the location in
 * the serialized data the column sidecar can be found.
 *
 * NOTE that the custody index is 1-indexed but JS arrays are 0-indexed so this must be accounted
 * for in getIndexOfSidecarInWrapper
 *
 * NOTE this heuristic does not work if the MAX_NUMBER_OF_COLUMNS exceeds 255
 */
export function buildCustodyIndex(columnIndices: ColumnIndex[]): Uint8Array {
  // custody columns map which column maps to which index in the array of columns custodied
  // with zero representing it is not custodied
  const custodyIndex = new Uint8Array(NUMBER_OF_COLUMNS);
  let custodyAtIndex = 1;
  for (const columnIndex of columnIndices) {
    custodyIndex[columnIndex] = custodyAtIndex;
    custodyAtIndex++;
  }
  return custodyIndex;
}

/**
 * Get the 1-indexed array index from the custody index and convert to 0-indexed array index for
 * slicing a column from the serialized array of sidecars.  See note on buildCustodyIndex for more
 * details
 */
export function getIndexOfSidecarInWrapper(custodyIndex: Uint8Array, columnIndex: number): number {
  const offsetIndex = (custodyIndex[columnIndex] ?? 0) - 1;
  if (offsetIndex < 0) {
    throw new ResponseError(
      RespStatus.SERVER_ERROR,
      `dataColumnSidecar columnIndex=${columnIndex} offsetIndex=${offsetIndex} not custodied`
    );
  }
  return offsetIndex;
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
