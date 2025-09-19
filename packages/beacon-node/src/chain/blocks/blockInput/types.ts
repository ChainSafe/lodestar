import {ForkName} from "@lodestar/params";
import {ColumnIndex, RootHex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {VersionedHashes} from "../../../execution/index.js";

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
  recovery = "recovery",
}

export type PromiseParts<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
};

export type LogMetaBasic = {
  slot: number;
  blockRoot: string;
  timeCreatedSec: number;
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

export type BlockWithSource = SourceMeta & {block: SignedBeaconBlock; blockRootHex: RootHex};

export type BlobWithSource = SourceMeta & {blobSidecar: deneb.BlobSidecar};

export type ColumnWithSource = SourceMeta & {columnSidecar: fulu.DataColumnSidecar};

export type BlockHeaderMeta = {
  forkName: ForkName;
  slot: Slot;
  blockRootHex: string;
  parentRootHex: string;
};

export type CreateBlockInputMeta = {
  daOutOfRange: boolean;
  forkName: ForkName;
  blockRootHex: string;
};

export type BlockInputInit = BlockHeaderMeta & {
  daOutOfRange: boolean;
  timeCreated: number;
};

export type AddBlock<F extends ForkName = ForkName> = SourceMeta & {
  block: SignedBeaconBlock<F>;
  blockRootHex: string;
};

export type AddBlob = BlobWithSource & {
  blockRootHex: RootHex;
};

export type AddColumn = ColumnWithSource & {
  blockRootHex: RootHex;
};

export type BlobMeta = {
  index: number;
  blockRoot: Uint8Array;
  versionedHash: Uint8Array;
};

export type MissingColumnMeta = {
  missing: ColumnIndex[];
  versionedHashes: VersionedHashes;
};

/**
 * This is used to validate that BlockInput implementations follow some minimal subset of operations
 * and that adding a new implementation won't break consumers that rely on this subset.
 *
 * Practically speaking, this interface is only used internally.
 */
export interface IBlockInput<F extends ForkName = ForkName, TData extends DAData = DAData> {
  type: DAType;

  /** validator activities can't be performed on out of range data */
  daOutOfRange: boolean;

  timeCreatedSec: number;
  // block header metadata
  forkName: ForkName;
  slot: Slot;
  blockRootHex: string;
  parentRootHex: string;

  addBlock(props: AddBlock<F>, opts?: {throwOnDuplicateAdd: boolean}): void;
  /** Whether the block has been seen and validated. If true, `getBlock` is guaranteed to not throw */
  hasBlock(): boolean;
  getBlock(): SignedBeaconBlock<F>;
  getBlockSource(): SourceMeta;

  /** Whether all expected DA data has been seen and validated. */
  hasAllData(): boolean;

  /**
   * Whether the block and all DA data retrieved.
   * If true, `getBlock` is guaranteed to not throw,
   * and `getDAStatus` is guaranteed to be DAStatus.Complete
   */
  hasBlockAndAllData(): boolean;

  getLogMeta(): LogMetaBasic;

  /** Only safe to call when `hasBlockAndAllData` is true */
  getTimeComplete(): number;

  waitForBlock(timeout: number, signal?: AbortSignal): Promise<SignedBeaconBlock<F>>;
  waitForAllData(timeout: number, signal?: AbortSignal): Promise<TData>;
  waitForBlockAndAllData(timeout: number, signal?: AbortSignal): Promise<this>;
}
