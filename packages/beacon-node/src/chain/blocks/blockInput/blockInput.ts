import {ForkName, ForkPostDeneb, ForkPreDeneb} from "@lodestar/params";
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

export type BlockInput = BlockInputPreData | BlockInputBlobs | BlockInputColumns;

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

type BlockInputState<F extends ForkName> =
  | {
      blockStatus: BlockStatus.MissingBlock;
      daStatus: DAStatus.IncompleteData;
    }
  | {
      blockStatus: BlockStatus.MissingBlock;
      daStatus: DAStatus.CompleteData;
    }
  | {
      blockStatus: BlockStatus.HasBlock;
      daStatus: DAStatus.IncompleteData;
      block: SignedBeaconBlock<F>;
      source: SourceMeta;
    }
  | {
      blockStatus: BlockStatus.HasBlock;
      daStatus: DAStatus.CompleteData;
      block: SignedBeaconBlock<F>;
      source: SourceMeta;
      timeCompleteSec: number;
    };

export type BlockInputInit = BlockHeaderMeta & {
  daRequirement: DARequirement;
  timeBeginSec: number;
};

abstract class AbstractBlockInput<F extends ForkName = ForkName, TData extends DAData = DAData>
  implements IBlockInput<F, TData>
{
  abstract type: DAType;
  daRequirement: DARequirement;
  timeBeginSec: number;

  forkName: ForkName;
  slot: Slot;
  blockRootHex: string;
  parentRootHex: string;

  abstract state: BlockInputState<F>;

  protected blockPromise = createPromise<SignedBeaconBlock<F>>();
  protected dataPromise = createPromise<TData>();
  protected bothPromise = createPromise<this>();

  constructor(init: BlockInputInit) {
    this.daRequirement = init.daRequirement;
    this.timeBeginSec = init.timeBeginSec;
    this.forkName = init.forkName;
    this.slot = init.slot;
    this.blockRootHex = init.blockRootHex;
    this.parentRootHex = init.parentRootHex;
  }

  abstract addBlock(props: AddBlock<F>): void;

  hasBlock(): boolean {
    return this.state.blockStatus === BlockStatus.HasBlock;
  }

  getBlock(): SignedBeaconBlock<F> {
    if (this.state.blockStatus !== BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_BLOCK,
          blockRoot: this.blockRootHex,
        },
        "Cannot getBlock from BlockInput without a block"
      );
    }
    return this.state.block;
  }

  getBlockSource(): SourceMeta {
    if (this.state.blockStatus !== BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_BLOCK,
          blockRoot: this.blockRootHex,
        },
        "Cannot getBlockSource from BlockInput without a block"
      );
    }
    return this.state.source;
  }

  hasData(): boolean {
    return this.state.daStatus === DAStatus.CompleteData;
  }

  hasBlockAndData(): boolean {
    return this.state.blockStatus === BlockStatus.HasBlock && this.state.daStatus === DAStatus.CompleteData;
  }

  getLogMeta(): LogMetaBasic {
    return {
      blockRoot: prettyBytes(this.blockRootHex),
      slot: this.slot,
    };
  }

  getTimeComplete(): number {
    if (this.state.blockStatus !== BlockStatus.HasBlock || this.state.daStatus !== DAStatus.CompleteData) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISSING_TIME_COMPLETE,
          blockRoot: this.blockRootHex,
        },
        "Cannot getTimeComplete from BlockInput without a block and data"
      );
    }
    return this.state.timeCompleteSec;
  }

  async waitForBlock(timeout: number, signal?: AbortSignal): Promise<SignedBeaconBlock<F>> {
    if (this.state.blockStatus === BlockStatus.MissingBlock) {
      return await withTimeout(() => this.blockPromise.promise, timeout, signal);
    }
    return this.state.block;
  }
  async waitForData(timeout: number, signal?: AbortSignal): Promise<TData> {
    if (this.state.daStatus === DAStatus.IncompleteData) {
      await withTimeout(() => this.dataPromise.promise, timeout, signal);
    }
    // each BlockInput implementation maintains its own repr of data
    // so we just return the promise
    return this.dataPromise.promise;
  }
  async waitForBlockAndData(timeout: number, signal?: AbortSignal): Promise<this> {
    if (this.state.blockStatus === BlockStatus.MissingBlock || this.state.daStatus === DAStatus.IncompleteData) {
      return await withTimeout(() => this.bothPromise.promise, timeout, signal);
    }
    return this;
  }
}

// Pre-DA

type BlockInputPreDataState = {
  blockStatus: BlockStatus.HasBlock;
  daStatus: DAStatus.CompleteData;
  block: SignedBeaconBlock<ForkPreDeneb>;
  source: SourceMeta;
  timeCompleteSec: number;
};

/**
 * Pre-DA, BlockInput only has a single state.
 * - the block simply exists
 */
export class BlockInputPreData extends AbstractBlockInput<ForkPreDeneb, null> {
  type = DAType.PreData as const;

  state: BlockInputPreDataState;

  constructor(init: BlockInputInit, state: BlockInputPreDataState) {
    super(init);
    this.state = state;
  }

  static createFromBlock(props: AddBlock & CreateBlockInputMeta): BlockInputPreData {
    const init: BlockInputInit = {
      daRequirement: props.daRequirement,
      timeBeginSec: props.source.seenTimestampSec,
      forkName: props.forkName,
      slot: props.block.message.slot,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
    };
    const state: BlockInputPreDataState = {
      blockStatus: BlockStatus.HasBlock,
      daStatus: DAStatus.CompleteData,
      block: props.block,
      source: props.source,
      timeCompleteSec: props.source.seenTimestampSec,
    };
    return new BlockInputPreData(init, state);
  }

  addBlock(_: AddBlock): void {
    throw new BlockInputError(
      {
        code: BlockInputErrorCode.INVALID_CONSTRUCTION,
        blockRoot: this.blockRootHex,
      },
      "Cannot addBlock to BlockInputPreData"
    );
  }
}

// Blobs DA

export type ForkBlobs = ForkName.deneb | ForkName.electra;

type BlockInputBlobsState =
  | {
      blockStatus: BlockStatus.HasBlock;
      daStatus: DAStatus.CompleteData;
      versionHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkBlobs>;
      source: SourceMeta;
      timeCompleteSec: number;
    }
  | {
      blockStatus: BlockStatus.HasBlock;
      daStatus: DAStatus.IncompleteData;
      versionHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkBlobs>;
      source: SourceMeta;
    }
  | {
      blockStatus: BlockStatus.MissingBlock;
      daStatus: DAStatus.IncompleteData;
    };

/**
 * With blobs, BlockInput has several states:
 * - The block is seen and all blobs are seen
 * - The block is seen and all blobs are not yet seen
 * - The block is yet not seen and its unknown if all blobs are seen
 */
export class BlockInputBlobs extends AbstractBlockInput<ForkBlobs, deneb.BlobSidecars> {
  type = DAType.Blobs as const;

  state: BlockInputBlobsState;
  private blobsCache = new Map<BlobIndex, BlobWithSource>();

  constructor(init: BlockInputInit, state: BlockInputBlobsState) {
    super(init);
    this.state = state;
  }

  static createFromBlock(props: AddBlock<ForkBlobs> & CreateBlockInputMeta): BlockInputBlobs {
    const completeData =
      props.daRequirement === DARequirement.OutOfRange || props.block.message.body.blobKzgCommitments.length === 0;

    const state = {
      blockStatus: BlockStatus.HasBlock,
      daStatus: completeData ? DAStatus.CompleteData : DAStatus.IncompleteData,
      versionHashes: getVersionHashes(props.block),
      block: props.block,
      source: props.source,
      timeCompleteSec: completeData ? props.source.seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    const init: BlockInputInit = {
      daRequirement: props.daRequirement,
      timeBeginSec: props.source.seenTimestampSec,
      forkName: props.forkName,
      slot: props.block.message.slot,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
    };
    const blockInput = new BlockInputBlobs(init, state);
    blockInput.blockPromise.resolve(props.block);
    if (completeData) {
      blockInput.dataPromise.resolve([]);
      blockInput.bothPromise.resolve(blockInput);
    }
    return blockInput;
  }

  static createFromBlob(props: AddBlob & CreateBlockInputMeta): BlockInputBlobs {
    const state: BlockInputBlobsState = {
      blockStatus: BlockStatus.MissingBlock,
      daStatus: DAStatus.IncompleteData,
    };
    const init: BlockInputInit = {
      daRequirement: props.daRequirement,
      timeBeginSec: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.blobSidecar.signedBlockHeader.message.parentRoot),
      slot: props.blobSidecar.signedBlockHeader.message.slot,
    };
    const blockInput = new BlockInputBlobs(init, state);
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
      blockRoot: prettyBytes(this.blockRootHex),
      slot: this.slot,
      expectedBlobs:
        this.state.blockStatus === BlockStatus.HasBlock
          ? this.state.block.message.body.blobKzgCommitments.length
          : "unknown",
      receivedBlobs: this.blobsCache.size,
    };
  }

  addBlock({blockRootHex, block, source}: AddBlock<ForkBlobs>): void {
    if (this.state.blockStatus !== BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlock to BlockInputBlobs after it already has a block"
      );
    }

    // this check suffices for checking slot, parentRoot, and forkName
    if (blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: blockRootHex,
          source: source.source,
          peerId: `${source.peerIdStr}`,
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
      block,
      versionHashes: getVersionHashes(block),
      source,
      timeCompleteSec: daStatus === DAStatus.CompleteData ? source.seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    this.blockPromise.resolve(block);
    if (daStatus === DAStatus.CompleteData) {
      this.dataPromise.resolve(this.getBlobs());
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
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlob to BlockInputBlobs after it already is complete"
      );
    }

    // this check suffices for checking slot, parentRoot, and forkName
    if (blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: blockRootHex,
          source: source,
          peerId: `${peerIdStr}`,
        },
        "Blob BeaconBlockHeader blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (this.state.blockStatus === BlockStatus.HasBlock) {
      assertBlockAndBlobArePaired(this.blockRootHex, this.state.block, blobSidecar);
    }

    // TODO: (@matthewkeil) check for duplicates and add metric here
    // if (this.blobsCache.has(blobSidecar.index)) {
    //   this.metrics.blockInput.duplicateBlob.inc()
    // }

    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, seenTimestampSec, peerIdStr});

    if (
      this.state.blockStatus === BlockStatus.HasBlock &&
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
    if (this.state.blockStatus === BlockStatus.MissingBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INCOMPLETE_DATA,
          ...this.getLogMeta(),
        },
        "Cannot get missing blobs. Block is unknown"
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
          blockRoot: fromHex(this.blockRootHex),
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

  getBlobs(): deneb.BlobSidecars {
    return this.getAllBlobsWithSource().map(({blobSidecar}) => blobSidecar);
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

type BlockInputColumnsState =
  | {
      blockStatus: BlockStatus.HasBlock;
      daStatus: DAStatus.CompleteData;
      custodyStatus: DAStatus;
      block: SignedBeaconBlock<ForkPostFulu>;
      source: SourceMeta;
      timeCompleteSec: number;
    }
  | {
      blockStatus: BlockStatus.HasBlock;
      daStatus: DAStatus.IncompleteData;
      custodyStatus: DAStatus;
      block: SignedBeaconBlock<ForkPostFulu>;
      source: SourceMeta;
    }
  | {
      blockStatus: BlockStatus.MissingBlock;
      daStatus: DAStatus.CompleteData;
      custodyStatus: DAStatus;
    }
  | {
      blockStatus: BlockStatus.MissingBlock;
      daStatus: DAStatus.IncompleteData;
      custodyStatus: DAStatus;
    };
/**
 * With columns, BlockInput has several states:
 * - The block is seen and all required sampled columns are seen
 * - The block is seen and all required sampled columns are not yet seen
 * - The block is not yet seen and all required sampled columns are seen
 * - The block is not yet seen and all required sampled columns are not yet seen
 */
export class BlockInputColumns extends AbstractBlockInput<ForkPostFulu, fulu.DataColumnSidecars> {
  type = DAType.Columns as const;

  state: BlockInputColumnsState;

  private columnsCache = new Map<ColumnIndex, ColumnWithSource>();
  private readonly custodyConfig: CustodyConfig;

  private custodyPromise = createPromise<fulu.DataColumnSidecars>();

  constructor(init: BlockInputInit, state: BlockInputColumnsState, custodyConfig: CustodyConfig) {
    super(init);
    this.state = state;
    this.custodyConfig = custodyConfig;
  }

  static createFromBlock(
    props: AddBlock<ForkPostFulu> & CreateBlockInputMeta & {custodyConfig: CustodyConfig}
  ): BlockInputColumns {
    const completeData =
      props.daRequirement === DARequirement.OutOfRange || props.block.message.body.blobKzgCommitments.length === 0;
    const daStatus =
      completeData || props.custodyConfig.sampledColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const custodyStatus =
      completeData || props.custodyConfig.custodyColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const state = {
      blockStatus: BlockStatus.HasBlock,
      daStatus,
      custodyStatus,
      block: props.block,
      source: props.source,
      timeBeginSec: props.source.seenTimestampSec,
      timeCompleteSec: completeData ? props.source.seenTimestampSec : undefined,
    } as BlockInputColumnsState;
    const init: BlockInputInit = {
      daRequirement: props.daRequirement,
      timeBeginSec: props.source.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
      slot: props.block.message.slot,
    };
    const blockInput = new BlockInputColumns(init, state, props.custodyConfig);

    blockInput.blockPromise.resolve(props.block);
    if (daStatus === DAStatus.CompleteData) {
      blockInput.dataPromise.resolve([]);
      blockInput.bothPromise.resolve(blockInput);
    }
    if (custodyStatus === DAStatus.CompleteData) {
      blockInput.custodyPromise.resolve([]);
    }

    return blockInput;
  }

  static createFromColumn(props: AddColumn & CreateBlockInputMeta & {custodyConfig: CustodyConfig}): BlockInputColumns {
    const daStatus = props.custodyConfig.sampledColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const custodyStatus =
      props.custodyConfig.custodyColumns.length === 0 ? DAStatus.CompleteData : DAStatus.IncompleteData;
    const state: BlockInputColumnsState = {
      blockStatus: BlockStatus.MissingBlock,
      daStatus,
      custodyStatus,
    };
    const init: BlockInputInit = {
      daRequirement: DARequirement.Required,
      timeBeginSec: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.columnSidecar.signedBlockHeader.message.parentRoot),
      slot: props.columnSidecar.signedBlockHeader.message.slot,
    };
    const blockInput = new BlockInputColumns(init, state, props.custodyConfig);
    if (daStatus === DAStatus.CompleteData) {
      blockInput.dataPromise.resolve([]);
    }
    if (custodyStatus === DAStatus.CompleteData) {
      blockInput.custodyPromise.resolve([]);
    }
    return blockInput;
  }

  getLogMeta(): LogMetaColumns {
    return {
      blockRoot: prettyBytes(this.blockRootHex),
      slot: this.slot,
      expectedColumns:
        this.state.blockStatus === BlockStatus.HasBlock && this.state.block.message.body.blobKzgCommitments.length === 0
          ? 0
          : this.custodyConfig.sampledColumns.length,
      receivedColumns: this.getSampledColumns(),
    };
  }

  addBlock(props: AddBlock<ForkPostFulu>): void {
    if (this.state.blockStatus === BlockStatus.HasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlock to BlockInputColumns after it already has a block"
      );
    }

    if (props.blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: props.blockRootHex,
          source: props.source.source,
          peerId: `${props.source.peerIdStr}`,
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

    const daStatus =
      props.block.message.body.blobKzgCommitments.length === 0 || this.state.daStatus === DAStatus.CompleteData
        ? DAStatus.CompleteData
        : DAStatus.IncompleteData;
    const custodyStatus =
      props.block.message.body.blobKzgCommitments.length === 0 || this.state.custodyStatus === DAStatus.CompleteData
        ? DAStatus.CompleteData
        : DAStatus.IncompleteData;

    this.state = {
      ...this.state,
      daStatus,
      custodyStatus,
      blockStatus: BlockStatus.HasBlock,
      block: props.block,
      source: props.source,
      timeCompleteSec: daStatus === DAStatus.CompleteData ? props.source.seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    this.blockPromise.resolve(props.block);
    if (daStatus === DAStatus.CompleteData) {
      this.bothPromise.resolve(this);
    }
  }

  addColumn({blockRootHex, columnSidecar, source, seenTimestampSec, peerIdStr}: AddColumn): void {
    if (blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: blockRootHex,
          source: source,
          peerId: `${peerIdStr}`,
        },
        "Column BeaconBlockHeader blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (this.state.blockStatus === BlockStatus.HasBlock) {
      assertBlockAndColumnArePaired(this.blockRootHex, this.state.block, columnSidecar);
    }

    this.columnsCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

    // check if we have freshly completed sampled or custody columns
    // eg: sampledComplete == true && sampledColumns !== null

    let sampledComplete = this.state.daStatus === DAStatus.CompleteData;
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
      daStatus: sampledComplete ? DAStatus.CompleteData : this.state.daStatus,
      custodyStatus: custodyComplete ? DAStatus.CompleteData : this.state.custodyStatus,
      timeCompleteSec: sampledComplete ? seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    if (sampledComplete && sampledColumns !== null) {
      this.dataPromise.resolve(sampledColumns);
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
    if (this.state.daStatus === DAStatus.CompleteData) {
      return [];
    }

    const needed: ColumnMeta[] = [];
    const blockRoot = fromHex(this.blockRootHex);
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
    const blockRoot = fromHex(this.blockRootHex);
    for (const index of this.custodyConfig.custodyColumns) {
      if (!this.columnsCache.has(index)) {
        needed.push({index, blockRoot});
      }
    }
    return needed;
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
