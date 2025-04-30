import {ForkName} from "@lodestar/params";
import {ColumnIndex, RootHex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";

export type CustodyConfig = {
  custodyColumns: ColumnIndex[];
  custodyColumnsIndex: Uint8Array;
  custodyColumnsLen: number;
  sampledColumns: ColumnIndex[];
};

/** Whether a block has been seen and validated for a given BlockInput */
export enum BlockStatus {
  /** block has not been seen */
  MissingBlock,
  /** block has been seen and validated */
  HasBlock,
}

/** Whether DA is required or not for a given BlockInput */
export enum DARequirement {
  /** Note: pre-DA, DA is assumed "required" even as no actual DA work is required */
  Required = "required",
  /* validator activities can't be performed on out of range data */
  OutOfRange = "out_of_range",
}

/** The status of DA for a given BlockInput */
export enum DAStatus {
  /** not all DA data is present */
  IncompleteData = "incomplete_data",
  /** all DA data is present */
  CompleteData = "complete_data",
}

export enum DAType {
  PreData = "pre-data",
  Blobs = "blobs",
  Columns = "columns",
}

export type DAData = null | deneb.BlobSidecars | fulu.DataColumnSidecars;

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
  slot: number;
  blockRoot: string;
};

export type LogMetaBlobs = LogMetaBasic & {
  expectedBlobs: number | string;
  receivedBlobs: number;
};

export type LogMetaColumns = LogMetaBasic & {
  expectedColumns: number;
  receivedColumns: number;
};

export type SourceMeta = {
  source: BlockInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

export type BlobWithSource = SourceMeta & {blobSidecar: deneb.BlobSidecar};

export type ColumnWithSource = SourceMeta & {columnSidecar: fulu.DataColumnSidecar};

export type BlockHeaderMeta = {
  forkName: ForkName;
  slot: Slot;
  blockRootHex: string;
  parentRootHex: string;
};

export type CreateBlockInputMeta = {
  daRequirement: DARequirement;
  forkName: ForkName;
  blockRootHex: string;
};

export type BlockInputInit = BlockHeaderMeta & {
  daRequirement: DARequirement;
  timeBeginSec: number;
};

export type AddBlock<F extends ForkName = ForkName> = {
  block: SignedBeaconBlock<F>;
  blockRootHex: string;
  source: SourceMeta;
};

export type AddBlob = BlobWithSource & {
  blockRootHex: RootHex;
};

export type AddColumn = ColumnWithSource & {
  blockRootHex: RootHex;
};

export type BlobMeta = ColumnMeta & {versionHash: Uint8Array};

export type ColumnMeta = {
  blockRoot: Uint8Array;
  index: number;
};

/**
 * This is used to validate that BlockInput implementations follow some minimal subset of operations
 * and that adding a new implementation won't break consumers that rely on this subset.
 *
 * Practically speaking, this interface is only used internally.
 */
export interface IBlockInput<F extends ForkName = ForkName, TData extends DAData = DAData> {
  type: DAType;

  daRequirement: DARequirement;
  timeBeginSec: number;
  // block header metadata
  forkName: ForkName;
  slot: Slot;
  blockRootHex: string;
  parentRootHex: string;

  addBlock(props: AddBlock<F>): void;
  /** Whether the block has been seen and validated. If true, `getBlock` is guaranteed to not throw */
  hasBlock(): boolean;
  getBlock(): SignedBeaconBlock<F>;
  getBlockSource(): SourceMeta;

  /** Whether all DA data has been seen and validated. If true, `getData` is guaranteed not throw */
  hasData(): boolean;

  /**
   * Whether the block and all DA data retrieved.
   * If true, `getBlock` is guaranteed to not throw,
   * and `getDAStatus` is guaranteed to be DAStatus.Complete
   */
  hasBlockAndData(): boolean;

  getLogMeta(): LogMetaBasic;
  /** Only safe to call when `hasBlockAndData` is true */
  getTimeComplete(): number;

  waitForBlock(timeout: number, signal?: AbortSignal): Promise<SignedBeaconBlock<F>>;
  waitForData(timeout: number, signal?: AbortSignal): Promise<TData>;
  waitForBlockAndData(timeout: number, signal?: AbortSignal): Promise<this>;
}
