import {ForkName, ForkPostDeneb, ForkPreDeneb, isForkPostDeneb} from "@lodestar/params";
import {BlobIndex, RootHex, SignedBeaconBlock, Slot, deneb} from "@lodestar/types";
import {fromHex, prettyBytes, toHex, withTimeout} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {byteArrayEquals} from "../../../util/bytes.js";
import {BlockInputError, BlockInputErrorCode} from "./errors.js";

// PR comment: fake fulu types to make the code compile with minimal diff
type ColumnIndex = number;
export type CustodyConfig = {
  custodyColumns: ColumnIndex[];
  custodyColumnsIndex: Uint8Array;
  custodyColumnsLen: number;
  sampledColumns: ColumnIndex[];
};

export type ForkPreFulu = ForkName.deneb | ForkName.electra;
export type ForkPostFulu = ForkName.fulu;
export function isForkPostFulu(fork: ForkName): fork is ForkPostFulu {
  return fork === ForkName.fulu;
}
// biome-ignore lint/style/noNamespace: fake types
namespace fulu {
  // biome-ignore lint/suspicious/noExplicitAny: fake types
  export type DataColumnSidecars = any;
  // biome-ignore lint/suspicious/noExplicitAny: fake types
  export type DataColumnSidecar = any;
  // biome-ignore lint/suspicious/noExplicitAny: fake types
  export type DataColumn = any;
  // biome-ignore lint/suspicious/noExplicitAny: fake types
  export type DataColumnIndex = any;
  // biome-ignore lint/suspicious/noExplicitAny: fake types
  export type DataColumnKzgCommitment = any;
  // biome-ignore lint/suspicious/noExplicitAny: fake types
  export type DataColumnKzgCommitments = any;
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
  /** Without a block, the DA status may not be known */
  Unknown = "unknown",
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

export type AddBlock<F extends ForkName = ForkName> = {
  block: SignedBeaconBlock<F>;
  forkName: F;
  blockRootHex: string;

  source: BlockInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

export type AddBlob<F extends ForkName = ForkBlobs> = {
  blobSidecar: deneb.BlobSidecar;
  forkName: F;
  blockRootHex: RootHex;

  source: BlockInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

export type AddColumn<F extends ForkName = ForkPostFulu> = {
  columnSidecar: fulu.DataColumnSidecar;
  forkName: F;
  blockRootHex: RootHex;

  source: BlockInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

export type BlobMeta = ColumnMeta & {versionHash: Uint8Array};

export type ColumnMeta = {
  blockRoot: Uint8Array;
  index: number;
};

export type BlockInput = BlockInputPreData | BlockInputBlobs | BlockInputColumns;

/**
 * This is used to validate that BlockInput implementations follow some minimal subset of operations
 * and that adding a new implementation won't break consumers that rely on this subset.
 *
 * Practically speaking, this interface is only used internally.
 */
export interface IBlockInput<F extends ForkName = ForkName, TData extends DAData = DAData> {
  type: DAType;

  // block header metadata

  forkName(): ForkName;
  slot(): Slot;
  blockRootHex(): string;
  parentRootHex(): string;

  /** Whether the block has been seen. If true, `getBlock` is guaranteed to not throw */
  hasBlock(): boolean;
  getBlock(): SignedBeaconBlock<F>;
  getBlockSource(): SourceMeta;
  addBlock(props: AddBlock<F>): void;

  getDAStatus(): DAStatus;

  /**
   * Whether the block and all DA data retrieved.
   * If true, `getBlock` is guaranteed to not throw,
   * and `getDAStatus` is guaranteed to be DAStatus.Complete
   */
  hasBlockAndData(): boolean;

  getLogMeta(): LogMetaBasic;
  getTimeBegin(): number;
  /** Only safe to call when `hasBlockAndData` is true */
  getTimeComplete(): number;

  waitForBlock(timeoutMs: number, abortSignal?: AbortSignal): Promise<SignedBeaconBlock<F>>;
  waitForData(timeoutMs: number, abortSignal?: AbortSignal): Promise<TData>;
  waitForBlockAndData(timeoutMs: number, abortSignal?: AbortSignal): Promise<this>;
}

export function createPromise<T>(): PromiseParts<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

// Pre-DA

type BlockInputPreDataState = {
  block: SignedBeaconBlock<ForkPreDeneb>;
  source: SourceMeta;
  forkName: ForkName;
  blockRootHex: string;
  parentRootHex: string;
};

/**
 * Pre-DA, BlockInput only has a single state.
 * - the block simply exists
 */
export class BlockInputPreData implements IBlockInput<ForkPreDeneb, null> {
  type = DAType.PreData as const;

  private state: BlockInputPreDataState;

  constructor(state: BlockInputPreDataState) {
    this.state = state;
  }

  static createFromBlock(props: AddBlock): BlockInputPreData {
    const state: BlockInputPreDataState = {
      block: props.block,
      source: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
    };
    return new BlockInputPreData(state);
  }

  hasBlock(): boolean {
    return true;
  }

  getBlock(): SignedBeaconBlock<ForkPreDeneb> {
    return this.state.block;
  }

  getBlockSource(): SourceMeta {
    return this.state.source;
  }

  addBlock(_: AddBlock): void {
    throw new BlockInputError(
      {
        code: BlockInputErrorCode.INVALID_CONSTRUCTION,
        blockRoot: this.state.blockRootHex,
      },
      "Cannot addBlock to BlockInputPreData"
    );
  }

  hasBlockAndData(): boolean {
    return true;
  }

  getDAStatus(): DAStatus {
    return DAStatus.CompleteData;
  }

  getLogMeta(): LogMetaBasic {
    return {
      blockRoot: prettyBytes(this.state.blockRootHex),
      slot: this.state.block.message.slot,
    };
  }

  slot(): Slot {
    return this.state.block.message.slot;
  }

  forkName(): ForkPreDeneb {
    return this.state.forkName as ForkPreDeneb;
  }

  blockRootHex(): string {
    return this.state.blockRootHex;
  }

  parentRootHex(): string {
    return this.state.parentRootHex;
  }

  getTimeBegin(): number {
    return this.state.source.seenTimestampSec;
  }

  getTimeComplete(): number {
    return this.state.source.seenTimestampSec;
  }

  async waitForBlock(_: number, __?: AbortSignal): Promise<SignedBeaconBlock<ForkPreDeneb>> {
    return this.state.block;
  }

  async waitForData(_: number, __?: AbortSignal): Promise<null> {
    return null;
  }

  async waitForBlockAndData(_: number, __?: AbortSignal): Promise<this> {
    return this;
  }
}

// Blobs DA

export type ForkBlobs = ForkName.deneb | ForkName.electra;

type BlockInputBlobsState =
  | {
      daRequirement: DARequirement;
      daStatus: DAStatus.CompleteData;

      forkName: ForkName;
      blockRootHex: string;
      parentRootHex: string;
      versionHashes: VersionedHashes;

      block: SignedBeaconBlock<ForkBlobs>;

      blockSource: SourceMeta;
      timeBeginSec: number;
      timeCompleteSec: number;
    }
  | {
      daRequirement: DARequirement;
      daStatus: DAStatus.IncompleteData;

      forkName: ForkName;
      blockRootHex: string;
      parentRootHex: string;
      versionHashes: VersionedHashes;

      block: SignedBeaconBlock<ForkBlobs>;

      blockSource: SourceMeta;
      timeBeginSec: number;
    }
  | {
      daRequirement: DARequirement.Required;
      daStatus: DAStatus.Unknown;

      forkName: ForkName;
      slot: Slot;
      blockRootHex: string;
      parentRootHex: string;

      timeBeginSec: number;
    };

/**
 * With blobs, BlockInput has several states:
 * - The block is seen and all blobs are seen
 * - The block is seen and all blobs are not yet seen
 * - The block is yet not seen and its unknown if all blobs are seen
 */
export class BlockInputBlobs implements IBlockInput<ForkBlobs, deneb.BlobSidecars> {
  type = DAType.Blobs as const;
  private blobsCache = new Map<BlobIndex, BlobWithSource>();
  private state: BlockInputBlobsState;
  private blockPromise = createPromise<SignedBeaconBlock<ForkBlobs>>();
  private dataPromise = createPromise<deneb.BlobSidecars>();
  private bothPromise = createPromise<this>();

  constructor(props: BlockInputBlobsState) {
    this.state = props;
  }

  static createFromBlock(props: AddBlock<ForkBlobs> & {daRequirement: DARequirement}): BlockInputBlobs {
    const completeData =
      props.daRequirement === DARequirement.OutOfRange || props.block.message.body.blobKzgCommitments.length === 0;

    const state = {
      daRequirement: props.daRequirement,
      daStatus: completeData ? DAStatus.CompleteData : DAStatus.IncompleteData,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
      versionHashes: getVersionHashes(props.block),
      block: props.block,
      blockSource: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeBeginSec: props.seenTimestampSec,
      timeCompleteSec: completeData ? props.seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    const blockInput = new BlockInputBlobs(state);
    blockInput.blockPromise.resolve(props.block);
    if (completeData) {
      blockInput.dataPromise.resolve([]);
      blockInput.bothPromise.resolve(blockInput);
    }
    return blockInput;
  }

  static createFromBlob(props: AddBlob): BlockInputBlobs {
    const state: BlockInputBlobsState = {
      daRequirement: DARequirement.Required,
      daStatus: DAStatus.Unknown,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.blobSidecar.signedBlockHeader.message.parentRoot),
      slot: props.blobSidecar.signedBlockHeader.message.slot,
      timeBeginSec: props.seenTimestampSec,
    };
    const blockInput = new BlockInputBlobs(state);
    blockInput.blobsCache.set(props.blobSidecar.index, {
      blobSidecar: props.blobSidecar,
      source: props.source,
      seenTimestampSec: props.seenTimestampSec,
      peerIdStr: props.peerIdStr,
    });
    return blockInput;
  }

  getLogMeta(): LogMetaBlobs {
    return {
      blockRoot: prettyBytes(this.state.blockRootHex),
      slot: this.state.daStatus === DAStatus.Unknown ? this.state.slot : this.state.block.message.slot,
      expectedBlobs:
        this.state.daStatus !== DAStatus.Unknown ? this.state.block.message.body.blobKzgCommitments.length : "unknown",
      receivedBlobs: this.blobsCache.size,
    };
  }

  forkName(): ForkBlobs {
    return this.state.forkName as ForkBlobs;
  }

  slot(): Slot {
    return this.state.daStatus === DAStatus.Unknown ? this.state.slot : this.state.block.message.slot;
  }

  blockRootHex(): string {
    return this.state.blockRootHex;
  }

  parentRootHex(): string {
    return this.state.parentRootHex;
  }

  hasBlock(): boolean {
    return this.state.daStatus !== DAStatus.Unknown;
  }

  hasBlockAndData(): boolean {
    return this.state.daStatus === DAStatus.CompleteData;
  }

  getBlock(): SignedBeaconBlock<ForkBlobs> {
    if (this.state.daStatus === DAStatus.Unknown) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_BLOCK,
          ...this.getLogMeta(),
        },
        "Cannot get block. Block is unknown"
      );
    }
    return this.state.block;
  }

  getBlockSource(): SourceMeta {
    if (this.state.daStatus === DAStatus.Unknown) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_BLOCK,
          ...this.getLogMeta(),
        },
        "Cannot get block. Block is unknown"
      );
    }
    return this.state.blockSource;
  }

  getDAStatus(): DAStatus {
    return this.state.daStatus;
  }

  getTimeBegin(): number {
    return this.state.timeBeginSec;
  }

  getTimeComplete(): number {
    if (this.state.daStatus !== DAStatus.CompleteData) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_TIME_COMPLETE,
          ...this.getLogMeta(),
        },
        "Cannot get time complete. Block is unknown"
      );
    }
    return this.state.timeCompleteSec;
  }

  addBlock({blockRootHex, block, source, peerIdStr, seenTimestampSec}: AddBlock<ForkBlobs>): void {
    if (this.state.daStatus !== DAStatus.Unknown) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.state.blockRootHex,
        },
        "Cannot addBlock to BlockInputBlobs after it already has a block"
      );
    }

    // this check suffices for checking slot, parentRoot, and forkName
    if (blockRootHex !== this.state.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.state.blockRootHex,
          mismatchedRoot: blockRootHex,
          source: source,
          peerId: `${peerIdStr}`,
        },
        "addBlock blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    for (const {blobSidecar} of this.blobsCache.values()) {
      if (!blockAndBlobArePaired(block, blobSidecar)) {
        this.blobsCache.delete(blobSidecar.index);
        // TODO: (@matthewkeil) spec says to ignore invalid blobs but should we downscore the peer maybe?
        // this.logger?.error(`Removing blobIndex=${blobSidecar.index} from BlockInput`, {}, err);
      }
    }

    const daStatus =
      this.blobsCache.size === block.message.body.blobKzgCommitments.length
        ? DAStatus.CompleteData
        : DAStatus.IncompleteData;

    this.state = {
      ...this.state,
      daStatus,
      block: block,
      versionHashes: getVersionHashes(block),
      blockSource: {
        source: source,
        seenTimestampSec: seenTimestampSec,
        peerIdStr: peerIdStr,
      },
      timeCompleteSec: daStatus === DAStatus.CompleteData ? seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    this.blockPromise.resolve(block);
    if (daStatus === DAStatus.CompleteData) {
      this.dataPromise.resolve(this.getAllBlobs() as deneb.BlobSidecars);
      this.bothPromise.resolve(this);
    }
  }

  hasBlob(blobIndex: BlobIndex): boolean {
    return this.blobsCache.has(blobIndex);
  }

  addBlob({blockRootHex, blobSidecar, source, peerIdStr, seenTimestampSec}: AddBlob): void {
    if (this.state.daStatus === DAStatus.CompleteData) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.state.blockRootHex,
        },
        "Cannot addBlob to BlockInputBlobs after it already is complete"
      );
    }

    // this check suffices for checking slot, parentRoot, and forkName
    if (blockRootHex !== this.state.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.state.blockRootHex,
          mismatchedRoot: blockRootHex,
          source: source,
          peerId: `${peerIdStr}`,
        },
        "Blob BeaconBlockHeader blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (this.state.daStatus === DAStatus.IncompleteData) {
      assertBlockAndBlobArePaired(this.state.blockRootHex, this.state.block, blobSidecar);
    }

    // TODO: (@matthewkeil) check for duplicates and add metric here
    // if (this.blobsCache.has(blobSidecar.index)) {
    //   this.metrics.blockInput.duplicateBlob.inc()
    // }

    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, seenTimestampSec, peerIdStr});

    if (
      this.state.daStatus === DAStatus.IncompleteData &&
      this.blobsCache.size === this.state.block.message.body.blobKzgCommitments.length
    ) {
      this.state = {
        ...this.state,
        daStatus: DAStatus.CompleteData,
        timeCompleteSec: seenTimestampSec,
      };
      this.dataPromise.resolve([...this.blobsCache.values()].map(({blobSidecar}) => blobSidecar));
      this.bothPromise.resolve(this);
    }
  }

  getMissingBlobMeta(): BlobMeta[] {
    if (this.state.daStatus === DAStatus.Unknown) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INCOMPLETE_DATA,
          ...this.getLogMeta(),
        },
        "Cannot get missing blobs.  Data is unknown"
      );
    }
    if (this.state.daStatus === DAStatus.CompleteData) {
      return [];
    }

    const blobMeta: BlobMeta[] = [];
    const versionHashes = this.state.versionHashes;
    for (let index = 0; index < versionHashes.length; index++) {
      if (!this.blobsCache.has(index)) {
        blobMeta.push({
          index,
          blockRoot: fromHex(this.state.blockRootHex),
          versionHash: versionHashes[index],
        });
      }
    }
    return blobMeta;
  }

  getAllBlobsWithSource(): BlobWithSource[] {
    if (this.state.daStatus !== DAStatus.CompleteData) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INCOMPLETE_DATA,
          ...this.getLogMeta(),
        },
        "Cannot get all blobs. DA status is not complete"
      );
    }
    return [...this.blobsCache.values()];
  }

  getAllBlobs(): deneb.BlobSidecars {
    return this.getAllBlobsWithSource().map(({blobSidecar}) => blobSidecar);
  }

  async waitForBlock(timeout: number, signal?: AbortSignal): Promise<SignedBeaconBlock<ForkBlobs>> {
    if (this.state.daStatus === DAStatus.Unknown) {
      return await withTimeout(() => this.blockPromise.promise, timeout, signal);
    }
    return this.state.block;
  }

  async waitForData(timeout: number, signal?: AbortSignal): Promise<deneb.BlobSidecars> {
    if (this.state.daStatus !== DAStatus.CompleteData) {
      return await withTimeout(() => this.dataPromise.promise, timeout, signal);
    }
    return this.getAllBlobs();
  }

  async waitForBlockAndData(timeout: number, signal?: AbortSignal): Promise<this> {
    if (this.state.daStatus !== DAStatus.CompleteData) {
      return await withTimeout(() => this.bothPromise.promise, timeout, signal);
    }
    return this;
  }
}

function getVersionHashes(block: SignedBeaconBlock<ForkPostDeneb>): VersionedHashes {
  return block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
}

function blockAndBlobArePaired(block: SignedBeaconBlock<ForkBlobs>, blobSidecar: deneb.BlobSidecar): boolean {
  return byteArrayEquals(block.message.body.blobKzgCommitments[blobSidecar.index], blobSidecar.kzgCommitment);
}

function assertBlockAndBlobArePaired(
  blockRootHex: string,
  block: SignedBeaconBlock<ForkBlobs>,
  blobSidecar: deneb.BlobSidecar
): void {
  if (!blockAndBlobArePaired(block, blobSidecar)) {
    // TODO: (@matthewkeil) should this eject the bad blob instead? No way to tell if the blob or the block
    //       has the invalid commitment. Guessing it would be the blob though because we match via block
    //       hashTreeRoot and we do not take a hashTreeRoot of the BlobSidecar
    throw new BlockInputError(
      {
        code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
        blockRoot: blockRootHex,
        slot: block.message.slot,
        sidecarIndex: blobSidecar.index,
      },
      "BlobSidecar commitment does not match block commitment"
    );
  }
}

// Columns DA

enum BlockStatus {
  MissingBlock,
  HasBlock,
}

type BlockInputColumnsState =
  | {
      daRequirement: DARequirement;
      sampledStatus: DAStatus.CompleteData;
      custodyStatus: DAStatus;
      blockStatus: BlockStatus.HasBlock;

      forkName: ForkName;
      blockRootHex: string;
      parentRootHex: string;

      block: SignedBeaconBlock<ForkPostFulu>;
      blockSource: SourceMeta;
      timeBeginSec: number;
      timeCompleteSec: number;
    }
  | {
      daRequirement: DARequirement;
      sampledStatus: DAStatus.IncompleteData;
      custodyStatus: DAStatus;
      blockStatus: BlockStatus.HasBlock;

      forkName: ForkName;
      blockRootHex: string;
      parentRootHex: string;

      block: SignedBeaconBlock<ForkPostFulu>;
      blockSource: SourceMeta;
      timeBeginSec: number;
    }
  | {
      daRequirement: DARequirement;
      sampledStatus: DAStatus.CompleteData;
      custodyStatus: DAStatus;
      blockStatus: BlockStatus.MissingBlock;

      forkName: ForkName;
      blockRootHex: string;
      parentRootHex: string;
      slot: Slot;

      timeBeginSec: number;
    }
  | {
      daRequirement: DARequirement;
      sampledStatus: DAStatus.IncompleteData;
      custodyStatus: DAStatus;
      blockStatus: BlockStatus.MissingBlock;

      forkName: ForkName;
      blockRootHex: string;
      parentRootHex: string;
      slot: Slot;

      timeBeginSec: number;
    };
/**
 * With columns, BlockInput has several states:
 * - The block is seen and all required sampled columns are seen
 * - The block is seen and all required sampled columns are not yet seen
 * - The block is not yet seen and all required sampled columns are seen
 * - The block is not yet seen and all required sampled columns are not yet seen
 */
export class BlockInputColumns implements IBlockInput<ForkPostFulu, fulu.DataColumnSidecars> {
  type = DAType.Columns as const;
  private columnsCache = new Map<ColumnIndex, ColumnWithSource>();
  private readonly custodyConfig: CustodyConfig;
  private state: BlockInputColumnsState;
  private custodyPromise = createPromise<fulu.DataColumnSidecars>();
  private sampledPromise = createPromise<fulu.DataColumnSidecars>();
  private blockPromise = createPromise<SignedBeaconBlock<ForkPostFulu>>();
  /** both sampled and block promises */
  private bothPromise = createPromise<this>();

  constructor(state: BlockInputColumnsState, custodyConfig: CustodyConfig) {
    this.custodyConfig = custodyConfig;
    this.state = state;
  }

  static createFromBlock(
    props: AddBlock<ForkPostFulu> & {daRequirement: DARequirement; custodyConfig: CustodyConfig}
  ): BlockInputColumns {
    const completeData =
      props.daRequirement === DARequirement.OutOfRange || props.block.message.body.blobKzgCommitments.length === 0;
    const sampledStatus =
      completeData || props.custodyConfig.sampledColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const custodyStatus =
      completeData || props.custodyConfig.custodyColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const state = {
      daRequirement: props.daRequirement,
      sampledStatus,
      custodyStatus,
      blockStatus: BlockStatus.HasBlock,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
      block: props.block,
      blockSource: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeBeginSec: props.seenTimestampSec,
      timeCompleteSec: completeData ? props.seenTimestampSec : undefined,
    } as BlockInputColumnsState;
    const blockInput = new BlockInputColumns(state, props.custodyConfig);

    blockInput.blockPromise.resolve(props.block);
    if (sampledStatus === DAStatus.CompleteData) {
      blockInput.sampledPromise.resolve([]);
      blockInput.bothPromise.resolve(blockInput);
    }
    if (custodyStatus === DAStatus.CompleteData) {
      blockInput.custodyPromise.resolve([]);
    }

    return blockInput;
  }

  static createFromColumn(props: AddColumn<ForkPostFulu> & {custodyConfig: CustodyConfig}): BlockInputColumns {
    const sampledStatus =
      props.custodyConfig.sampledColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const custodyStatus =
      props.custodyConfig.custodyColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const state: BlockInputColumnsState = {
      daRequirement: DARequirement.Required,
      sampledStatus,
      custodyStatus,
      blockStatus: BlockStatus.MissingBlock,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.columnSidecar.signedBlockHeader.message.parentRoot),
      slot: props.columnSidecar.signedBlockHeader.message.slot,
      timeBeginSec: props.seenTimestampSec,
    };
    const blockInput = new BlockInputColumns(state, props.custodyConfig);
    if (sampledStatus === DAStatus.CompleteData) {
      blockInput.sampledPromise.resolve([]);
    }
    if (custodyStatus === DAStatus.CompleteData) {
      blockInput.custodyPromise.resolve([]);
    }
    return blockInput;
  }

  getLogMeta(): LogMetaColumns {
    return {
      blockRoot: prettyBytes(this.state.blockRootHex),
      slot: this.state.blockStatus === BlockStatus.HasBlock ? this.state.block.message.slot : this.state.slot,
      expectedColumns:
        this.state.blockStatus === BlockStatus.HasBlock && this.state.block.message.body.blobKzgCommitments.length === 0
          ? 0
          : this.custodyConfig.sampledColumns.length,
      receivedColumns: this.getSampledColumns(),
    };
  }

  slot(): Slot {
    if (this.state.blockStatus === BlockStatus.HasBlock) {
      return this.state.block.message.slot;
    }
    return this.state.slot;
  }

  forkName(): ForkPostFulu {
    return this.state.forkName as ForkPostFulu;
  }

  blockRootHex(): string {
    return this.state.blockRootHex;
  }

  parentRootHex(): string {
    return this.state.parentRootHex;
  }

  hasBlock(): boolean {
    return this.state.blockStatus === BlockStatus.HasBlock;
  }

  getBlock(): SignedBeaconBlock<ForkPostFulu> {
    if (this.state.blockStatus !== BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_BLOCK,
          blockRoot: this.state.blockRootHex,
        },
        "Cannot getBlock from BlockInputColumns without a block"
      );
    }
    return this.state.block;
  }

  getBlockSource(): SourceMeta {
    if (this.state.blockStatus !== BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_BLOCK,
          blockRoot: this.state.blockRootHex,
        },
        "Cannot getBlockSource from BlockInputColumns without a block"
      );
    }
    return this.state.blockSource;
  }

  getDAStatus(): DAStatus {
    return this.state.sampledStatus;
  }

  hasBlockAndData(): boolean {
    return this.state.blockStatus === BlockStatus.HasBlock && this.state.sampledStatus === DAStatus.CompleteData;
  }

  getTimeBegin(): number {
    return this.state.timeBeginSec;
  }

  getTimeComplete(): number {
    if (this.state.blockStatus !== BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_BLOCK,
          blockRoot: this.state.blockRootHex,
        },
        "Cannot getTimeComplete from BlockInputColumns without a block"
      );
    }
    if (this.state.sampledStatus !== DAStatus.CompleteData) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_TIME_COMPLETE,
          blockRoot: this.state.blockRootHex,
        },
        "Cannot getTimeComplete from BlockInputColumns without sampled data"
      );
    }
    return this.state.timeCompleteSec;
  }

  addBlock(props: AddBlock<ForkPostFulu>): void {
    if (this.state.blockStatus === BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.state.blockRootHex,
        },
        "Cannot addBlock to BlockInputColumns after it already has a block"
      );
    }

    if (props.blockRootHex !== this.state.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.state.blockRootHex,
          mismatchedRoot: props.blockRootHex,
          source: props.source,
          peerId: `${props.peerIdStr}`,
        },
        "addBlock blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    for (const {columnSidecar} of this.columnsCache.values()) {
      if (!blockAndColumnArePaired(props.block, columnSidecar)) {
        this.columnsCache.delete(columnSidecar.index);
        // this.logger?.error(`Removing columnIndex=${columnSidecar.index} from BlockInput`, {}, err);
      }
    }

    const sampledStatus =
      props.block.message.body.blobKzgCommitments.length === 0 || this.state.sampledStatus === DAStatus.CompleteData
        ? DAStatus.CompleteData
        : DAStatus.IncompleteData;
    const custodyStatus =
      props.block.message.body.blobKzgCommitments.length === 0 || this.state.custodyStatus === DAStatus.CompleteData
        ? DAStatus.CompleteData
        : DAStatus.IncompleteData;

    this.state = {
      ...this.state,
      sampledStatus,
      custodyStatus,
      blockStatus: BlockStatus.HasBlock,
      block: props.block,
      blockSource: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeCompleteSec: sampledStatus === DAStatus.CompleteData ? props.seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    this.blockPromise.resolve(props.block);
    if (sampledStatus === DAStatus.CompleteData) {
      this.bothPromise.resolve(this);
    }
  }

  addColumn({blockRootHex, columnSidecar, source, seenTimestampSec, peerIdStr}: AddColumn): void {
    if (blockRootHex !== this.state.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.state.blockRootHex,
          mismatchedRoot: blockRootHex,
          source: source,
          peerId: `${peerIdStr}`,
        },
        "Column BeaconBlockHeader blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (this.state.blockStatus === BlockStatus.HasBlock) {
      assertBlockAndColumnArePaired(this.state.blockRootHex, this.state.block, columnSidecar);
    }

    this.columnsCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

    // check if we have freshly completed sampled or custody columns
    // eg: sampledComplete == true && sampledColumns !== null

    let sampledComplete = this.state.sampledStatus === DAStatus.CompleteData;
    let sampledColumns: fulu.DataColumnSidecars | null = null;
    // biome-ignore lint/suspicious/noConfusingLabels: <explanation>
    maybeSampleComplete: if (!sampledComplete) {
      sampledColumns = [];
      for (const index of this.custodyConfig.sampledColumns) {
        const column = this.columnsCache.get(index);
        if (column) {
          sampledColumns.push(index);
        } else {
          break maybeSampleComplete;
        }
      }
      sampledComplete = true;
    }

    let custodyComplete = this.state.custodyStatus === DAStatus.CompleteData;
    let custodyColumns: fulu.DataColumnSidecars | null = null;
    // biome-ignore lint/suspicious/noConfusingLabels: <explanation>
    maybeCustodyComplete: if (!custodyComplete) {
      custodyColumns = [];
      for (const index of this.custodyConfig.custodyColumns) {
        const column = this.columnsCache.get(index);
        if (column) {
          custodyColumns.push(index);
        } else {
          break maybeCustodyComplete;
        }
      }
      custodyComplete = true;
    }

    this.state = {
      ...this.state,
      sampledStatus: sampledComplete ? DAStatus.CompleteData : this.state.sampledStatus,
      custodyStatus: custodyComplete ? DAStatus.CompleteData : this.state.custodyStatus,
      timeCompleteSec: sampledComplete ? seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    if (sampledComplete && sampledColumns !== null) {
      this.sampledPromise.resolve(sampledColumns);
      if (this.state.blockStatus === BlockStatus.HasBlock) {
        this.bothPromise.resolve(this);
      }
    }
    if (custodyComplete && custodyColumns !== null) {
      this.custodyPromise.resolve(custodyColumns);
    }
  }

  hasColumn(columnIndex: number): boolean {
    return this.columnsCache.has(columnIndex);
  }

  getCustodyColumns(): fulu.DataColumnSidecars {
    const columns: fulu.DataColumnSidecars = [];
    for (const index of this.custodyConfig.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar);
      }
    }
    return columns;
  }

  getSampledColumns(): fulu.DataColumnSidecars {
    const columns: fulu.DataColumnSidecars = [];
    for (const index of this.custodyConfig.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar);
      }
    }
    return columns;
  }

  getAllColumnsWithSource(): ColumnWithSource[] {
    return [...this.columnsCache.values()];
  }

  getAllColumns(): fulu.DataColumnSidecars {
    return this.getAllColumnsWithSource().map(({columnSidecar}) => columnSidecar);
  }

  getMissingSampledColumnMeta(): ColumnMeta[] {
    if (this.state.sampledStatus === DAStatus.CompleteData) {
      return [];
    }

    const needed: ColumnMeta[] = [];
    const blockRoot = fromHex(this.state.blockRootHex);
    for (const index of this.custodyConfig.sampledColumns) {
      if (!this.columnsCache.has(index)) {
        needed.push({index, blockRoot});
      }
    }
    return needed;
  }

  getMissingCustodyColumnMeta(): ColumnMeta[] {
    if (this.state.custodyStatus === DAStatus.CompleteData) {
      return [];
    }

    const needed: ColumnMeta[] = [];
    const blockRoot = fromHex(this.state.blockRootHex);
    for (const index of this.custodyConfig.custodyColumns) {
      if (!this.columnsCache.has(index)) {
        needed.push({index, blockRoot});
      }
    }
    return needed;
  }

  async waitForBlock(timeoutMs: number, abortSignal?: AbortSignal): Promise<SignedBeaconBlock<ForkPostFulu>> {
    if (this.state.blockStatus !== BlockStatus.HasBlock) {
      return withTimeout(() => this.blockPromise.promise, timeoutMs, abortSignal);
    }
    return this.state.block;
  }

  async waitForData(timeoutMs: number, abortSignal?: AbortSignal): Promise<fulu.DataColumnSidecars> {
    if (this.state.sampledStatus !== DAStatus.CompleteData) {
      return withTimeout(() => this.sampledPromise.promise, timeoutMs, abortSignal);
    }
    return this.getSampledColumns();
  }

  async waitForBlockAndData(timeoutMs: number, abortSignal?: AbortSignal): Promise<this> {
    if (this.state.blockStatus !== BlockStatus.HasBlock || this.state.sampledStatus !== DAStatus.CompleteData) {
      return withTimeout(() => this.bothPromise.promise, timeoutMs, abortSignal);
    }
    return this;
  }
}

function blockAndColumnArePaired(
  block: SignedBeaconBlock<ForkPostFulu>,
  columnSidecar: fulu.DataColumnSidecar
): boolean {
  return (
    block.message.body.blobKzgCommitments.length === columnSidecar.kzgCommitments.length &&
    block.message.body.blobKzgCommitments.every((commitment, index) =>
      byteArrayEquals(commitment, columnSidecar.kzgCommitments[index])
    )
  );
}

function assertBlockAndColumnArePaired(
  blockRootHex: string,
  block: SignedBeaconBlock<ForkPostFulu>,
  columnSidecar: fulu.DataColumnSidecar
): void {
  if (!blockAndColumnArePaired(block, columnSidecar)) {
    throw new BlockInputError(
      {
        code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
        blockRoot: blockRootHex,
        slot: block.message.slot,
        sidecarIndex: columnSidecar.index,
      },
      "DataColumnsSidecar kzgCommitment does not match block kzgCommitment"
    );
  }
}
