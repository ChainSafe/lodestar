import {
  ByteVectorType,
  ContainerType,
  ListBasicType,
  ListCompositeType,
  VectorBasicType,
  VectorCompositeType,
} from "@chainsafe/ssz";
import {
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_CELL,
  FIELD_ELEMENTS_PER_EXT_BLOB,
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  MIN_SEED_LOOKAHEAD,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";

import {ssz as altairSsz} from "../altair/index.js";
import {ssz as denebSsz} from "../deneb/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Root, ColumnIndex, RowIndex, Bytes32, Slot, UintNum64, ValidatorIndex} = primitiveSsz;

export const KZGProof = denebSsz.KZGProof;
export const Blob = denebSsz.Blob;

export const Metadata = new ContainerType(
  {
    ...altairSsz.Metadata.fields,
    custodyGroupCount: UintNum64,
  },
  {typeName: "Metadata", jsonCase: "eth2"}
);
export const Status = new ContainerType(
  {
    ...phase0Ssz.Status.fields,
    earliestAvailableSlot: Slot,
  },
  {typeName: "Status", jsonCase: "eth2"}
);

export const Cell = new ByteVectorType(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_CELL);
export const DataColumn = new ListCompositeType(Cell, MAX_BLOB_COMMITMENTS_PER_BLOCK);
export const DataColumns = new ListCompositeType(DataColumn, NUMBER_OF_COLUMNS);
export const ExtendedMatrix = new ListCompositeType(Cell, MAX_BLOB_COMMITMENTS_PER_BLOCK * NUMBER_OF_COLUMNS);
export const KzgCommitmentsInclusionProof = new VectorCompositeType(Bytes32, KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH);
export const KZGProofs = new ListCompositeType(
  denebSsz.KZGProof,
  FIELD_ELEMENTS_PER_EXT_BLOB * MAX_BLOB_COMMITMENTS_PER_BLOCK
);
export const ProposerLookahead = new VectorBasicType(ValidatorIndex, (MIN_SEED_LOOKAHEAD + 1) * SLOTS_PER_EPOCH);

export const DataColumnSidecar = new ContainerType(
  {
    index: ColumnIndex,
    column: DataColumn,
    kzgCommitments: denebSsz.BlobKzgCommitments,
    kzgProofs: denebSsz.KZGProofs,
    signedBlockHeader: phase0Ssz.SignedBeaconBlockHeader,
    kzgCommitmentsInclusionProof: KzgCommitmentsInclusionProof,
  },
  {typeName: "DataColumnSidecar", jsonCase: "eth2"}
);

export const DataColumnSidecars = new ListCompositeType(DataColumnSidecar, NUMBER_OF_COLUMNS);

export const MatrixEntry = new ContainerType(
  {
    cell: Cell,
    kzgProof: denebSsz.KZGProof,
    columnIndex: ColumnIndex,
    rowIndex: RowIndex,
  },
  {typeName: "MatrixEntry", jsonCase: "eth2"}
);

// ReqResp types
// =============

export const DataColumnsByRootIdentifier = new ContainerType(
  {
    blockRoot: Root,
    columns: new ListBasicType(ColumnIndex, NUMBER_OF_COLUMNS),
  },
  {typeName: "DataColumnsByRootIdentifier", jsonCase: "eth2"}
);

export const DataColumnSidecarsByRangeRequest = new ContainerType(
  {
    startSlot: Slot,
    count: UintNum64,
    columns: new ListBasicType(ColumnIndex, NUMBER_OF_COLUMNS),
  },
  {typeName: "DataColumnSidecarsByRangeRequest", jsonCase: "eth2"}
);

// Explicit aliases for a few common types
export const BeaconBlock = electraSsz.BeaconBlock;
export const SignedBeaconBlock = electraSsz.SignedBeaconBlock;

// Containers
export const BlobsBundle = new ContainerType(
  {
    commitments: denebSsz.BlobKzgCommitments,
    proofs: KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "BlobsBundle", jsonCase: "eth2"}
);

export const BeaconState = new ContainerType(
  {
    ...electraSsz.BeaconState.fields,
    proposerLookahead: ProposerLookahead, // New in FULU:EIP7917
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const BlockContents = new ContainerType(
  {
    block: electraSsz.BeaconBlock,
    kzgProofs: KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

export const SignedBlockContents = new ContainerType(
  {
    signedBlock: electraSsz.SignedBeaconBlock,
    kzgProofs: KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "SignedBlockContents", jsonCase: "eth2"}
);
