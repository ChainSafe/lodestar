import {ForkName, ForkPostDeneb, ForkPostElectra, ForkPreDeneb} from "@lodestar/params";
import {
  RootHex,
  SignedBeaconBlock,
  deneb,
  // fulu
} from "@lodestar/types";
// import {CustodyConfig} from "../../../util/dataColumns.js";
import {PeerIdStr} from "../../../util/peerId.js";

export enum DataAvailabilityStatus {
  Unknown = "unknown",
  PreData = "pre_data",
  Available = "available",
  /* validator activities can't be performed on out of range data */
  OutOfRange = "out_of_range",
}

export enum BlockInputDataStatus {
  NoData = "no_data",
  IncompleteData = "incomplete_data",
  CompleteData = "complete_data",
}

export enum BlockInputType {
  Unknown = "unknown",
  PreData = "pre-data",
  Blobs = "blobs",
  // Columns = "columns",
}

export type PossibleDataTypes = null | deneb.BlobSidecars; // | fulu.DataColumnSidecars

/**
 * Represents were input originated. Blocks and Data can come from different
 * sources so each should be labelled individually.
 */
export enum BlockInputSource {
  gossip = "gossip",
  api = "api",
  engine = "engine",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
}

export type PromiseParts<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
};

export type LogMetaBasic = {
  slot: number | string;
  blockRoot: string;
};

export type LogMetaBlobs = LogMetaBasic & {
  expectedBlobs: string;
  receivedBlobs: number;
};

// export type LogMetaColumns = LogMetaBasic & {
//   expectedColumns: number;
//   receivedColumns: number;
// };

export type SourceMeta = {
  source: BlockInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

export type BlockWithSource<BlockType extends SignedBeaconBlock> = SourceMeta & {
  block: BlockType;
};

export type BlobWithSource = SourceMeta & {blobSidecar: deneb.BlobSidecar};

// export type ColumnWithSource = SourceMeta & {columnSidecar: fulu.DataColumnSidecar};

export type AddBlockProps<BlockType extends SignedBeaconBlock> = BlockWithSource<BlockType> & {
  rootHex: string;
  blockRoot: Uint8Array;
  forkName: ForkName;
  dataAvailability: DataAvailabilityStatus;
};

export type AddBlobProps = BlobWithSource & {rootHex: RootHex};

// export type AddColumnProps = ColumnWithSource & {rootHex: RootHex};

export type BlobMeta = ColumnMeta & {versionHash: Uint8Array};

export type ColumnMeta = {
  blockRoot: Uint8Array;
  index: number;
};

export type BlockInputBaseProps = {
  rootHex: string;
  blockRoot: Uint8Array;
};

export type BlockInputPreDataProps<BlockType extends SignedBeaconBlock> =
  | BlockInputBaseProps
  | AddBlockProps<BlockType>;

export type BlockInputBlobsProps<BlockType extends SignedBeaconBlock> =
  | BlockInputPreDataProps<BlockType>
  | (AddBlobProps & {blockRoot: Uint8Array});

// export type BlockInputColumnsProps<BlockType extends SignedBeaconBlock> = {
//   custodyConfig: CustodyConfig;
// } & (BlockInputPreDataProps<BlockType> | (AddColumnProps & {blockRoot: Uint8Array}));
