import {ForkName, ForkPostFulu, ForkPostGloas, ForkPreDeneb, ForkPreGloas, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {BeaconBlockBody, BlobIndex, ColumnIndex, SignedBeaconBlock, Slot, deneb, fulu, gloas} from "@lodestar/types";
import {byteArrayEquals, fromHex, prettyBytes, toRootHex, withTimeout} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {BlockInputError, BlockInputErrorCode} from "./errors.js";
import {
  AddBlob,
  AddBlock,
  AddColumn,
  AddPayloadEnvelope,
  BlobMeta,
  BlobWithSource,
  BlockInputInit,
  ColumnConfig,
  ColumnWithSource,
  CreateBlockInputMeta,
  DAData,
  DAType,
  GloasDAData,
  IBlockInput,
  LogMetaBasic,
  LogMetaBlobs,
  LogMetaColumns,
  LogMetaEpbs,
  MissingColumnMeta,
  PromiseParts,
  SourceMeta,
} from "./types.js";

export type BlockInput = BlockInputPreData | BlockInputBlobs | BlockInputColumns | BlockInputEpbs;

export function isBlockInputPreDeneb(blockInput: IBlockInput): blockInput is BlockInputPreData {
  return blockInput.type === DAType.PreData;
}
export function isBlockInputBlobs(blockInput: IBlockInput): blockInput is BlockInputBlobs {
  return blockInput.type === DAType.Blobs;
}

export function isBlockInputColumns(blockInput: IBlockInput): blockInput is BlockInputColumns {
  return blockInput.type === DAType.Columns;
}

export function isBlockInputEpbs(blockInput: IBlockInput): blockInput is BlockInputEpbs {
  return blockInput.type === DAType.Epbs;
}

function createPromise<T>(): PromiseParts<T> {
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
      hasBlock: false;
      hasAllData: false;
    }
  | {
      hasBlock: false;
      hasAllData: true;
    }
  | {
      hasBlock: true;
      hasAllData: false;
      block: SignedBeaconBlock<F>;
      source: SourceMeta;
    }
  | {
      hasBlock: true;
      hasAllData: true;
      block: SignedBeaconBlock<F>;
      source: SourceMeta;
      timeCompleteSec: number;
    };

abstract class AbstractBlockInput<F extends ForkName = ForkName, TData extends DAData = DAData>
  implements IBlockInput<F, TData>
{
  abstract type: DAType;
  daOutOfRange: boolean;
  timeCreatedSec: number;

  forkName: ForkName;
  slot: Slot;
  blockRootHex: string;
  parentRootHex: string;

  abstract state: BlockInputState<F>;

  protected blockPromise = createPromise<SignedBeaconBlock<F>>();
  protected dataPromise = createPromise<TData>();

  constructor(init: BlockInputInit) {
    this.daOutOfRange = init.daOutOfRange;
    this.timeCreatedSec = init.timeCreated;
    this.forkName = init.forkName;
    this.slot = init.slot;
    this.blockRootHex = init.blockRootHex;
    this.parentRootHex = init.parentRootHex;
  }

  abstract addBlock(props: AddBlock<F>): void;

  hasBlock(): boolean {
    return this.state.hasBlock;
  }

  getBlock(): SignedBeaconBlock<F> {
    if (!this.state.hasBlock) {
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
    if (!this.state.hasBlock) {
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

  hasAllData(): boolean {
    return this.state.hasAllData;
  }

  hasBlockAndAllData(): boolean {
    return this.state.hasBlock && this.state.hasAllData;
  }

  getLogMeta(): LogMetaBasic {
    return {
      slot: this.slot,
      blockRoot: prettyBytes(this.blockRootHex),
      timeCreatedSec: this.timeCreatedSec,
    };
  }

  getTimeComplete(): number {
    if (!this.state.hasBlock || !this.state.hasAllData) {
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

  waitForBlock(timeout: number, signal?: AbortSignal): Promise<SignedBeaconBlock<F>> {
    if (!this.state.hasBlock) {
      return withTimeout(() => this.blockPromise.promise, timeout, signal);
    }
    return Promise.resolve(this.state.block);
  }
  waitForAllData(timeout: number, signal?: AbortSignal): Promise<TData> {
    return withTimeout(() => this.dataPromise.promise, timeout, signal);
  }

  async waitForBlockAndAllData(timeout: number, signal?: AbortSignal): Promise<this> {
    if (!this.state.hasBlock || !this.state.hasAllData) {
      await withTimeout(() => Promise.all([this.blockPromise.promise, this.dataPromise.promise]), timeout, signal);
    }
    return this;
  }
}

// Pre-DA

type BlockInputPreDataState = {
  hasBlock: true;
  hasAllData: true;
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

  private constructor(init: BlockInputInit, state: BlockInputPreDataState) {
    super(init);
    this.state = state;
    this.dataPromise.resolve(null);
    this.blockPromise.resolve(state.block);
  }

  static createFromBlock(props: AddBlock & CreateBlockInputMeta): BlockInputPreData {
    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      slot: props.block.message.slot,
      blockRootHex: props.blockRootHex,
      parentRootHex: toRootHex(props.block.message.parentRoot),
    };
    const state: BlockInputPreDataState = {
      hasBlock: true,
      hasAllData: true,
      block: props.block,
      source: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeCompleteSec: props.seenTimestampSec,
    };
    return new BlockInputPreData(init, state);
  }

  addBlock(_: AddBlock, opts = {throwOnDuplicateAdd: true}): void {
    if (opts.throwOnDuplicateAdd) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlock to BlockInputPreData"
      );
    }
  }
}

// Blobs DA

export type ForkBlobsDA = ForkName.deneb | ForkName.electra;

type BlockInputBlobsState =
  | {
      hasBlock: true;
      hasAllData: true;
      versionedHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkBlobsDA>;
      source: SourceMeta;
      timeCompleteSec: number;
    }
  | {
      hasBlock: true;
      hasAllData: false;
      versionedHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkBlobsDA>;
      source: SourceMeta;
    }
  | {
      hasBlock: false;
      hasAllData: false;
    };

/**
 * With blobs, BlockInput has several states:
 * - The block is seen and all blobs are seen
 * - The block is seen and all blobs are not yet seen
 * - The block is yet not seen and its unknown if all blobs are seen
 */
export class BlockInputBlobs extends AbstractBlockInput<ForkBlobsDA, deneb.BlobSidecars> {
  type = DAType.Blobs as const;

  state: BlockInputBlobsState;
  private blobsCache = new Map<BlobIndex, BlobWithSource>();

  private constructor(init: BlockInputInit, state: BlockInputBlobsState) {
    super(init);
    this.state = state;
  }

  static createFromBlock(props: AddBlock<ForkBlobsDA> & CreateBlockInputMeta): BlockInputBlobs {
    const hasAllData = props.daOutOfRange || props.block.message.body.blobKzgCommitments.length === 0;

    const state = {
      hasBlock: true,
      hasAllData,
      versionedHashes: props.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      block: props.block,
      source: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeCompleteSec: hasAllData ? props.seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      slot: props.block.message.slot,
      blockRootHex: props.blockRootHex,
      parentRootHex: toRootHex(props.block.message.parentRoot),
    };
    const blockInput = new BlockInputBlobs(init, state);
    blockInput.blockPromise.resolve(props.block);
    if (hasAllData) {
      blockInput.dataPromise.resolve([]);
    }
    return blockInput;
  }

  static createFromBlob(props: AddBlob & CreateBlockInputMeta): BlockInputBlobs {
    const state: BlockInputBlobsState = {
      hasBlock: false,
      hasAllData: false,
    };
    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toRootHex(props.blobSidecar.signedBlockHeader.message.parentRoot),
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
      slot: this.slot,
      blockRoot: prettyBytes(this.blockRootHex),
      timeCreatedSec: this.timeCreatedSec,
      expectedBlobs: this.state.hasBlock ? this.state.block.message.body.blobKzgCommitments.length : "unknown",
      receivedBlobs: this.blobsCache.size,
    };
  }

  addBlock(
    {blockRootHex, block, source, seenTimestampSec, peerIdStr}: AddBlock<ForkBlobsDA>,
    opts = {throwOnDuplicateAdd: true}
  ): void {
    // this check suffices for checking slot, parentRoot, and forkName
    if (blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: blockRootHex,
          source,
          peerId: `${peerIdStr}`,
        },
        "addBlock blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (!opts.throwOnDuplicateAdd) {
      return;
    }

    if (this.state.hasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlock to BlockInputBlobs after it already has a block"
      );
    }

    for (const {blobSidecar} of this.blobsCache.values()) {
      if (!blockAndBlobArePaired(block, blobSidecar)) {
        this.blobsCache.delete(blobSidecar.index);
        // TODO: (@matthewkeil) spec says to ignore invalid blobs but should we downscore the peer maybe?
        // this.logger?.error(`Removing blobIndex=${blobSidecar.index} from BlockInput`, {}, err);
      }
    }

    const hasAllData = this.blobsCache.size === block.message.body.blobKzgCommitments.length;

    this.state = {
      ...this.state,
      hasBlock: true,
      hasAllData,
      block,
      versionedHashes: block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      source: {
        source,
        seenTimestampSec,
        peerIdStr,
      },
      timeCompleteSec: hasAllData ? seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    this.blockPromise.resolve(block);
    if (hasAllData) {
      this.dataPromise.resolve(this.getBlobs());
    }
  }

  hasBlob(blobIndex: BlobIndex): boolean {
    return this.blobsCache.has(blobIndex);
  }

  getBlob(blobIndex: BlobIndex): deneb.BlobSidecar | undefined {
    return this.blobsCache.get(blobIndex)?.blobSidecar;
  }

  addBlob(
    {blockRootHex, blobSidecar, source, peerIdStr, seenTimestampSec}: AddBlob,
    opts = {throwOnDuplicateAdd: true}
  ): void {
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

    const isDuplicate = this.blobsCache.has(blobSidecar.index);
    if (isDuplicate && opts.throwOnDuplicateAdd) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlob to BlockInputBlobs with duplicate blobIndex"
      );
    }

    if (this.state.hasBlock) {
      assertBlockAndBlobArePaired(this.blockRootHex, this.state.block, blobSidecar);
    }

    if (isDuplicate) {
      return;
    }

    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, seenTimestampSec, peerIdStr});

    if (this.state.hasBlock && this.blobsCache.size === this.state.block.message.body.blobKzgCommitments.length) {
      this.state = {
        ...this.state,
        hasAllData: true,
        timeCompleteSec: seenTimestampSec,
      };
      this.dataPromise.resolve([...this.blobsCache.values()].map(({blobSidecar}) => blobSidecar));
    }
  }

  getVersionedHashes(): VersionedHashes {
    if (!this.state.hasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INCOMPLETE_DATA,
          ...this.getLogMeta(),
        },
        "Cannot get versioned hashes. Block is unknown"
      );
    }
    return this.state.versionedHashes;
  }

  getMissingBlobMeta(): BlobMeta[] {
    if (!this.state.hasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INCOMPLETE_DATA,
          ...this.getLogMeta(),
        },
        "Cannot get missing blobs. Block is unknown"
      );
    }
    if (this.state.hasAllData) {
      return [];
    }

    const blobMeta: BlobMeta[] = [];
    const versionedHashes = this.state.versionedHashes;
    for (let index = 0; index < versionedHashes.length; index++) {
      if (!this.blobsCache.has(index)) {
        blobMeta.push({
          index,
          blockRoot: fromHex(this.blockRootHex),
          versionedHash: versionedHashes[index],
        });
      }
    }
    return blobMeta;
  }

  getAllBlobsWithSource(): BlobWithSource[] {
    if (!this.state.hasAllData) {
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

function blockAndBlobArePaired(block: SignedBeaconBlock<ForkBlobsDA>, blobSidecar: deneb.BlobSidecar): boolean {
  const blockCommitment = block.message.body.blobKzgCommitments[blobSidecar.index];
  if (!blockCommitment || !blobSidecar.kzgCommitment) {
    return false;
  }
  return byteArrayEquals(blockCommitment, blobSidecar.kzgCommitment);
}

function assertBlockAndBlobArePaired(
  blockRootHex: string,
  block: SignedBeaconBlock<ForkBlobsDA>,
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

export type ForkColumnsDA = ForkName.fulu;

type BlockInputColumnsState =
  | {
      hasBlock: true;
      hasAllData: true;
      hasComputedAllData: boolean;
      versionedHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkColumnsDA>;
      source: SourceMeta;
      timeCompleteSec: number;
    }
  | {
      hasBlock: true;
      hasAllData: false;
      hasComputedAllData: false;
      versionedHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkColumnsDA>;
      source: SourceMeta;
    }
  | {
      hasBlock: false;
      hasAllData: true;
      hasComputedAllData: boolean;
      versionedHashes: VersionedHashes;
    }
  | {
      hasBlock: false;
      hasAllData: false;
      hasComputedAllData: false;
      versionedHashes: VersionedHashes;
    };
/**
 * With columns, BlockInput has several states:
 * - The block is seen and all required sampled columns are seen
 * - The block is seen and all required sampled columns are not yet seen
 * - The block is not yet seen and all required sampled columns are seen
 * - The block is not yet seen and all required sampled columns are not yet seen
 */
export class BlockInputColumns extends AbstractBlockInput<ForkColumnsDA, fulu.DataColumnSidecars> {
  type = DAType.Columns as const;

  state: BlockInputColumnsState;

  private columnsCache = new Map<ColumnIndex, ColumnWithSource>();
  private readonly sampledColumns: ColumnIndex[];
  private readonly custodyColumns: ColumnIndex[];
  /**
   * This promise resolves when all sampled columns are available
   *
   * This is different from `dataPromise` which resolves when all data is available or could become available (e.g. through reconstruction)
   */
  protected computedDataPromise = createPromise<fulu.DataColumnSidecars>();

  private constructor(
    init: BlockInputInit,
    state: BlockInputColumnsState,
    sampledColumns: ColumnIndex[],
    custodyColumns: ColumnIndex[]
  ) {
    super(init);
    this.state = state;
    this.sampledColumns = sampledColumns;
    this.custodyColumns = custodyColumns;
  }

  get columnCount(): number {
    return this.columnsCache.size;
  }

  static createFromBlock(props: AddBlock<ForkColumnsDA> & CreateBlockInputMeta & ColumnConfig): BlockInputColumns {
    const hasAllData =
      props.daOutOfRange ||
      props.block.message.body.blobKzgCommitments.length === 0 ||
      props.sampledColumns.length === 0;
    const state = {
      hasBlock: true,
      hasAllData,
      hasComputedAllData: hasAllData,
      versionedHashes: props.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      block: props.block,
      source: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeCreated: props.seenTimestampSec,
      timeCompleteSec: hasAllData ? props.seenTimestampSec : undefined,
    } as BlockInputColumnsState;
    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toRootHex(props.block.message.parentRoot),
      slot: props.block.message.slot,
    };
    const blockInput = new BlockInputColumns(init, state, props.sampledColumns, props.custodyColumns);

    blockInput.blockPromise.resolve(props.block);
    if (hasAllData) {
      blockInput.dataPromise.resolve([]);
      blockInput.computedDataPromise.resolve([]);
    }
    return blockInput;
  }

  static createFromColumn(props: AddColumn & CreateBlockInputMeta & ColumnConfig): BlockInputColumns {
    const fuluColumn = props.columnSidecar as fulu.DataColumnSidecar;
    const hasAllData =
      props.daOutOfRange || fuluColumn.kzgCommitments.length === 0 || props.sampledColumns.length === 0;
    const state: BlockInputColumnsState = {
      hasBlock: false,
      hasAllData,
      hasComputedAllData: hasAllData as false,
      versionedHashes: fuluColumn.kzgCommitments.map(kzgCommitmentToVersionedHash),
    };
    const init: BlockInputInit = {
      daOutOfRange: false,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toRootHex(fuluColumn.signedBlockHeader.message.parentRoot),
      slot: fuluColumn.signedBlockHeader.message.slot,
    };
    const blockInput = new BlockInputColumns(init, state, props.sampledColumns, props.custodyColumns);
    if (hasAllData) {
      blockInput.dataPromise.resolve([]);
      blockInput.computedDataPromise.resolve([]);
    }
    return blockInput;
  }

  getLogMeta(): LogMetaColumns {
    return {
      slot: this.slot,
      blockRoot: prettyBytes(this.blockRootHex),
      timeCreatedSec: this.timeCreatedSec,
      expectedColumns:
        this.state.hasBlock && this.state.block.message.body.blobKzgCommitments.length === 0
          ? 0
          : this.sampledColumns.length,
      receivedColumns: this.getSampledColumns().length,
    };
  }

  addBlock(props: AddBlock<ForkColumnsDA>, opts = {throwOnDuplicateAdd: true}): void {
    if (props.blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: props.blockRootHex,
          source: props.source,
          peerId: `${props.peerIdStr}`,
        },
        "addBlock blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (!opts.throwOnDuplicateAdd) {
      return;
    }

    if (this.state.hasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlock to BlockInputColumns after it already has a block"
      );
    }

    const hasAllData =
      (props.block.message.body as BeaconBlockBody<ForkPostFulu & ForkPreGloas>).blobKzgCommitments.length === 0 ||
      this.state.hasAllData;
    const hasComputedAllData =
      props.block.message.body.blobKzgCommitments.length === 0 || this.state.hasComputedAllData;

    this.state = {
      ...this.state,
      hasBlock: true,
      hasAllData,
      hasComputedAllData,
      block: props.block,
      source: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeCompleteSec: hasAllData ? props.seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    this.blockPromise.resolve(props.block);
  }

  addColumn(
    {blockRootHex, columnSidecar, source, seenTimestampSec, peerIdStr}: AddColumn,
    opts = {throwOnDuplicateAdd: true}
  ): void {
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

    const isDuplicate = this.columnsCache.has(columnSidecar.index);
    if (isDuplicate && opts.throwOnDuplicateAdd) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addColumn to BlockInputColumns with duplicate column index"
      );
    }

    if (isDuplicate) {
      return;
    }

    this.columnsCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

    const sampledColumns = this.getSampledColumns();
    const hasAllData =
      // already hasAllData
      this.state.hasAllData ||
      // has all sampled columns
      sampledColumns.length === this.sampledColumns.length ||
      // has enough columns to reconstruct the rest
      this.columnsCache.size >= NUMBER_OF_COLUMNS / 2;

    const hasComputedAllData =
      // has all sampled columns
      sampledColumns.length === this.sampledColumns.length;

    this.state = {
      ...this.state,
      hasAllData: hasAllData || this.state.hasAllData,
      hasComputedAllData: hasComputedAllData || this.state.hasComputedAllData,
      timeCompleteSec: hasAllData ? seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    if (hasAllData && sampledColumns !== null) {
      this.dataPromise.resolve(sampledColumns);
    }

    if (hasComputedAllData && sampledColumns !== null) {
      this.computedDataPromise.resolve(sampledColumns);
    }
  }

  hasColumn(columnIndex: number): boolean {
    return this.columnsCache.has(columnIndex);
  }

  getColumn(columnIndex: number): fulu.DataColumnSidecar | undefined {
    return this.columnsCache.get(columnIndex)?.columnSidecar as fulu.DataColumnSidecar | undefined;
  }

  getVersionedHashes(): VersionedHashes {
    return this.state.versionedHashes;
  }

  getCustodyColumns(): fulu.DataColumnSidecars {
    const columns: fulu.DataColumnSidecars = [];
    for (const index of this.custodyColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar as fulu.DataColumnSidecar);
      }
    }
    return columns;
  }

  getSampledColumnsWithSource(): ColumnWithSource[] {
    const columns: ColumnWithSource[] = [];
    for (const index of this.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column);
      }
    }
    return columns;
  }

  getSampledColumns(): fulu.DataColumnSidecars {
    const columns: fulu.DataColumnSidecars = [];
    for (const index of this.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar as fulu.DataColumnSidecar);
      }
    }
    return columns;
  }

  getAllColumnsWithSource(): ColumnWithSource[] {
    return [...this.columnsCache.values()];
  }

  getAllColumns(): fulu.DataColumnSidecars {
    return this.getAllColumnsWithSource().map(({columnSidecar}) => columnSidecar as fulu.DataColumnSidecar);
  }

  getMissingSampledColumnMeta(): MissingColumnMeta {
    if (this.state.hasAllData) {
      return {
        missing: [],
        versionedHashes: this.state.versionedHashes,
      };
    }

    const missing: number[] = [];
    for (const index of this.sampledColumns) {
      if (!this.columnsCache.has(index)) {
        missing.push(index);
      }
    }
    return {
      missing,
      versionedHashes: this.state.versionedHashes,
    };
  }

  hasComputedAllData(): boolean {
    return this.state.hasComputedAllData;
  }

  waitForComputedAllData(timeout: number, signal?: AbortSignal): Promise<fulu.DataColumnSidecars> {
    if (!this.state.hasComputedAllData) {
      return withTimeout(() => this.computedDataPromise.promise, timeout, signal);
    }
    return Promise.resolve(this.getSampledColumns());
  }
}

// Gloas ePBS

type BlockInputEpbsState =
  | {
      // Complete: Have everything needed
      hasBlock: true;
      // Note: hasAllData means all data requirement is satisfied OR can be reconstructed (>= NUMBER_OF_COLUMNS/2).
      // hasComputedAllData means all actual sampled columns are present (not just recoverable).
      // If payloadAvailable === true, this means all data columns + payload are present (or recoverable)
      // If payloadAvailable === false, this means no payload and no columns since we don't need them
      hasAllData: true;
      hasComputedAllData: boolean;
      block: SignedBeaconBlock<ForkPostGloas>;
      versionedHashes: VersionedHashes;
      source: SourceMeta;
      timeCompleteSec: number;
      payloadAvailable: boolean;
    }
  | {
      // Have block, missing payload and/or columns
      hasBlock: true;
      hasAllData: false;
      hasComputedAllData: false;
      block: SignedBeaconBlock<ForkPostGloas>;
      versionedHashes: VersionedHashes;
      source: SourceMeta;
    }
  | {
      // Have both payload and all columns, but no block yet (rare)
      // versionedHashes not available yet — only known when block arrives (from bid's blobKzgCommitments)
      hasBlock: false;
      hasAllData: true;
      hasComputedAllData: boolean;
      timeCompleteSec: number;
    }
  | {
      // Missing block, and missing payload or columns or both
      // versionedHashes not available yet — only known when block arrives (from bid's blobKzgCommitments)
      hasBlock: false;
      hasAllData: false;
      hasComputedAllData: false;
    };

/**
 * With Gloas ePBS, BlockInput has several states:
 * - The block is seen, execution payload envelope is seen, and all required sampled columns are seen
 * - The block is seen, no execution payload envelope or columns are seen, but DA is not required (daOutOfRange or no sampled columns)
 * - The block is seen but missing payload envelope and/or columns.
 * - The block is seen but builder chose not to reveal payload (markPayloadUnavailable called after ~1 slot timeout)
 * - The block is not yet seen but payload envelope and all columns are seen
 * - The block is not yet seen and missing payload envelope and/or columns
 *
 * In Gloas ePBS:
 * - Execution payloads arrive separately as SignedExecutionPayloadEnvelope
 * - Data columns provide DA proof required by is_data_available()
 * - Both payload envelope AND all sampled columns are required for completion
 * - Alternatively, if daOutOfRange or no sampled columns are required, the block can be complete without payload or columns
 * - Builder may not reveal: After sufficient time (~1 slot), if PTC votes indicate payload absent,
 *   markPayloadUnavailable() is called which marks data as complete (hasAllData=true) with null payload.
 *   This is valid even when the block had non-zero expected data columns.
 */
export class BlockInputEpbs extends AbstractBlockInput<ForkPostGloas, GloasDAData | null> {
  type = DAType.Epbs as const;

  state: BlockInputEpbsState;

  private payloadEnvelope: gloas.SignedExecutionPayloadEnvelope | null = null;
  private columnsCache = new Map<ColumnIndex, ColumnWithSource>();
  private readonly sampledColumns: ColumnIndex[];
  private readonly custodyColumns: ColumnIndex[];
  // Whether payload data is expected. Set to false when:
  // - DA not required (daOutOfRange, no sampled columns, no blobs) → data already complete
  // - Builder non-reveal (markPayloadUnavailable called) → proceed without payload
  // When false, addPayloadEnvelope() and addColumn() will throw.
  private payloadAvailable = true;
  protected computedDataPromise = createPromise<GloasDAData | null>();

  private constructor(
    init: BlockInputInit,
    state: BlockInputEpbsState,
    sampledColumns: ColumnIndex[],
    custodyColumns: ColumnIndex[]
  ) {
    super(init);
    this.state = state;
    this.sampledColumns = sampledColumns;
    this.custodyColumns = custodyColumns;
  }

  get columnCount(): number {
    return this.columnsCache.size;
  }

  static createFromBlock(props: AddBlock<ForkPostGloas> & CreateBlockInputMeta & ColumnConfig): BlockInputEpbs {
    // In Gloas, blobKzgCommitments are on the ExecutionPayloadBid (in the block body),
    // so versionedHashes can be determined immediately when the block arrives.
    const blobKzgCommitments = props.block.message.body.signedExecutionPayloadBid.message
      .blobKzgCommitments;
    const versionedHashes = blobKzgCommitments.map(kzgCommitmentToVersionedHash);
    // Block is immediately complete if DA not required (daOutOfRange), no blobs (no columns needed),
    // or no sampled columns.
    const hasAllData =
      props.daOutOfRange || blobKzgCommitments.length === 0 || props.sampledColumns.length === 0;
    // hasComputedAllData is always true when no columns needed
    const hasComputedAllData = hasAllData;

    const state: BlockInputEpbsState = hasAllData
      ? {
          hasBlock: true,
          hasAllData: true,
          hasComputedAllData,
          versionedHashes,
          block: props.block,
          source: {
            source: props.source,
            seenTimestampSec: props.seenTimestampSec,
            peerIdStr: props.peerIdStr,
          },
          timeCompleteSec: props.seenTimestampSec,
          payloadAvailable: false, // No payload needed (daOutOfRange or no columns)
        }
      : {
          hasBlock: true,
          hasAllData: false,
          hasComputedAllData: false,
          versionedHashes,
          block: props.block,
          source: {
            source: props.source,
            seenTimestampSec: props.seenTimestampSec,
            peerIdStr: props.peerIdStr,
          },
        };

    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toRootHex(props.block.message.parentRoot),
      slot: props.block.message.slot,
    };

    const blockInput = new BlockInputEpbs(init, state, props.sampledColumns, props.custodyColumns);
    blockInput.blockPromise.resolve(props.block);
    if (hasAllData) {
      blockInput.payloadAvailable = false;
      blockInput.dataPromise.resolve(null);
      blockInput.computedDataPromise.resolve(null);
    }
    return blockInput;
  }

  static createFromPayload(props: AddPayloadEnvelope & CreateBlockInputMeta & ColumnConfig): BlockInputEpbs {
    // Without the block, we can't determine blob count. Complete only if daOutOfRange or no sampled columns.
    // versionedHashes are not available yet — they come from the block's bid blobKzgCommitments.
    const hasAllData = props.daOutOfRange || props.sampledColumns.length === 0;
    const hasComputedAllData = hasAllData;

    const state: BlockInputEpbsState = hasAllData
      ? {
          hasBlock: false,
          hasAllData: true,
          hasComputedAllData,
          timeCompleteSec: props.seenTimestampSec,
        }
      : {
          hasBlock: false,
          hasAllData: false,
          hasComputedAllData: false,
        };

    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      // Payload envelope doesn't contain parent root - use empty placeholder until block arrives
      parentRootHex: "0x" + "0".repeat(64),
      slot: props.payloadEnvelope.message.slot,
    };

    const blockInput = new BlockInputEpbs(init, state, props.sampledColumns, props.custodyColumns);
    blockInput.payloadEnvelope = props.payloadEnvelope;
    if (hasAllData) {
      // DA requirement satisfied immediately - no further payload/column data expected
      blockInput.payloadAvailable = false;
      blockInput.dataPromise.resolve(null);
      blockInput.computedDataPromise.resolve(null);
    }
    return blockInput;
  }

  static createFromColumn(props: AddColumn & CreateBlockInputMeta & ColumnConfig): BlockInputEpbs {
    // Without the block, we can't determine blob count. Complete only if daOutOfRange or no sampled columns.
    // versionedHashes are not available yet — they come from the block's bid blobKzgCommitments.
    const hasAllData = props.daOutOfRange || props.sampledColumns.length === 0;
    const hasComputedAllData = hasAllData;

    const state: BlockInputEpbsState = hasAllData
      ? {
          hasBlock: false,
          hasAllData: true,
          hasComputedAllData,
          timeCompleteSec: props.seenTimestampSec,
        }
      : {
          hasBlock: false,
          hasAllData: false,
          hasComputedAllData: false,
        };

    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      // Gloas DataColumnSidecar doesn't contain parent root, will be set when block arrives
      parentRootHex: "0x" + "0".repeat(64),
      slot: (props.columnSidecar as gloas.DataColumnSidecar).slot,
    };

    const blockInput = new BlockInputEpbs(init, state, props.sampledColumns, props.custodyColumns);
    blockInput.addColumn(props, {throwOnDuplicateAdd: false});
    if (hasAllData) {
      // DA requirement satisfied immediately - no further payload/column data expected
      blockInput.payloadAvailable = false;
      blockInput.dataPromise.resolve(null);
      blockInput.computedDataPromise.resolve(null);
    }
    return blockInput;
  }

  getLogMeta(): LogMetaEpbs {
    return {
      slot: this.slot,
      blockRoot: prettyBytes(this.blockRootHex),
      timeCreatedSec: this.timeCreatedSec,
      hasPayload: this.payloadEnvelope !== null,
      payloadAvailable: this.payloadAvailable,
      expectedColumns: this.sampledColumns.length,
      receivedColumns: this.getSampledColumns().length,
    };
  }

  addBlock(props: AddBlock<ForkPostGloas>, opts = {throwOnDuplicateAdd: true}): void {
    if (props.blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: props.blockRootHex,
          source: props.source,
          peerId: `${props.peerIdStr}`,
        },
        "addBlock blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (!opts.throwOnDuplicateAdd) {
      return;
    }

    if (this.state.hasBlock) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlock to BlockInputEpbs after it already has a block"
      );
    }

    // Extract versionedHashes from the block's bid 
    const blobKzgCommitments = props.block.message.body.signedExecutionPayloadBid.message
      .blobKzgCommitments;
    const versionedHashes = blobKzgCommitments.map(kzgCommitmentToVersionedHash);

    // Check if we already have all data (payload + columns OR payload unavailable OR no blobs)
    const hasPayloadEnvelope = this.payloadEnvelope !== null;
    const sampledColumnsReceived = this.getSampledColumns().length;
    const hasAllSampledColumns = sampledColumnsReceived === this.sampledColumns.length;
    const hasEnoughColumnsToReconstruct = this.columnsCache.size >= NUMBER_OF_COLUMNS / 2;
    const noBlobs = blobKzgCommitments.length === 0;

    // hasAllData = can start block import (may need reconstruction)
    const hasAllData =
      !this.payloadAvailable ||
      noBlobs ||
      (hasPayloadEnvelope && (hasAllSampledColumns || hasEnoughColumnsToReconstruct)) ||
      this.state.hasAllData;

    // hasComputedAllData = all actual sampled columns present (no reconstruction needed)
    const hasComputedAllData = noBlobs || (hasPayloadEnvelope && hasAllSampledColumns) || this.state.hasComputedAllData;

    // If block reveals no blobs, mark payload unavailable since no further data is expected
    if (noBlobs && this.payloadAvailable) {
      this.payloadAvailable = false;
    }

    this.state = {
      ...this.state,
      hasBlock: true,
      hasAllData,
      hasComputedAllData,
      versionedHashes,
      block: props.block,
      source: {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      },
      timeCompleteSec: hasAllData ? props.seenTimestampSec : undefined,
      payloadAvailable: this.payloadAvailable,
    } as BlockInputEpbsState;

    this.blockPromise.resolve(props.block);
    if (hasAllData) {
      const sampledColumns = this.getSampledColumns();
      const daData = this.payloadEnvelope && sampledColumns ? {payloadEnvelope: this.payloadEnvelope, columns: sampledColumns} : null;
      this.dataPromise.resolve(daData);
    }
    if (hasComputedAllData) {
      const sampledColumns = this.getSampledColumns();
      const daData = this.payloadEnvelope && sampledColumns ? {payloadEnvelope: this.payloadEnvelope, columns: sampledColumns} : null;
      this.computedDataPromise.resolve(daData);
    }
  }

  addPayloadEnvelope(props: AddPayloadEnvelope, opts = {throwOnDuplicateAdd: true}): void {
    if (props.blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: props.blockRootHex,
          source: props.source,
          peerId: `${props.peerIdStr}`,
        },
        "Payload envelope blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    // Validate beacon block root matches
    const payloadBlockRoot = toRootHex(props.payloadEnvelope.message.beaconBlockRoot);
    if (payloadBlockRoot !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: payloadBlockRoot,
          source: props.source,
          peerId: `${props.peerIdStr}`,
        },
        "Payload envelope beacon_block_root does not match BlockInput.blockRootHex"
      );
    }

    if (!this.payloadAvailable) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.PAYLOAD_UNAVAILABLE_MARKED,
          blockRoot: this.blockRootHex,
        },
        "Cannot add payload envelope after payload marked unavailable (DA requirement already satisfied)"
      );
    }

    const isDuplicate = this.payloadEnvelope !== null;
    if (isDuplicate && opts.throwOnDuplicateAdd) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.PAYLOAD_ENVELOPE_ALREADY_SET,
          blockRoot: this.blockRootHex,
        },
        "Cannot addPayloadEnvelope to BlockInputEpbs with existing payload envelope"
      );
    }

    if (isDuplicate) {
      return;
    }

    this.payloadEnvelope = props.payloadEnvelope;
    // Check if we now have all data (payload + all columns)
    const sampledColumns = this.getSampledColumns();
    const hasAllSampledColumns = sampledColumns.length === this.sampledColumns.length;
    const hasEnoughColumnsToReconstruct = this.columnsCache.size >= NUMBER_OF_COLUMNS / 2;

    // hasAllData = can start block import (may need reconstruction)
    const hasAllData = hasAllSampledColumns || hasEnoughColumnsToReconstruct;
    // hasComputedAllData = all actual sampled columns present (no reconstruction needed)
    const hasComputedAllData = hasAllSampledColumns;

    if (hasAllData && this.payloadEnvelope) {
      this.state = {
        ...this.state,
        hasAllData: true,
        hasComputedAllData: hasComputedAllData || this.state.hasComputedAllData,
        timeCompleteSec: props.seenTimestampSec,
      } as BlockInputEpbsState;
      this.dataPromise.resolve({
        payloadEnvelope: this.payloadEnvelope,
        columns: sampledColumns,
      });
    }

    if (hasComputedAllData && this.payloadEnvelope) {
      this.computedDataPromise.resolve({
        payloadEnvelope: this.payloadEnvelope,
        columns: sampledColumns,
      });
    }
  }

  addColumn(
    {blockRootHex, columnSidecar, source, seenTimestampSec, peerIdStr}: AddColumn,
    opts = {throwOnDuplicateAdd: true}
  ): void {
    if (blockRootHex !== this.blockRootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.blockRootHex,
          mismatchedRoot: blockRootHex,
          source: source,
          peerId: `${peerIdStr}`,
        },
        "Column blockRootHex does not match BlockInput.blockRootHex"
      );
    }

    if (!this.payloadAvailable) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.PAYLOAD_UNAVAILABLE_MARKED,
          blockRoot: this.blockRootHex,
        },
        "Cannot add column after payload marked unavailable (DA requirement already satisfied)"
      );
    }

    const isDuplicate = this.columnsCache.has(columnSidecar.index);
    if (isDuplicate && opts.throwOnDuplicateAdd) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addColumn to BlockInputEpbs with duplicate column index"
      );
    }

    if (isDuplicate) {
      return;
    }

    this.columnsCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

    // Check if we now have all data (payload + all columns)
    const sampledColumns = this.getSampledColumns();
    const hasAllSampledColumns = sampledColumns.length === this.sampledColumns.length;
    const hasEnoughColumnsToReconstruct = this.columnsCache.size >= NUMBER_OF_COLUMNS / 2;
    const hasPayloadEnvelope = this.payloadEnvelope !== null;

    // hasAllData = can start block import (may need reconstruction)
    const hasAllData = hasPayloadEnvelope && (hasAllSampledColumns || hasEnoughColumnsToReconstruct);
    // hasComputedAllData = all actual sampled columns present (no reconstruction needed)
    const hasComputedAllData = hasPayloadEnvelope && hasAllSampledColumns;

    if (hasAllData && this.payloadEnvelope) {
      this.state = {
        ...this.state,
        hasAllData: true,
        hasComputedAllData: hasComputedAllData || this.state.hasComputedAllData,
        timeCompleteSec: seenTimestampSec,
      } as BlockInputEpbsState;
      this.dataPromise.resolve({
        payloadEnvelope: this.payloadEnvelope,
        columns: sampledColumns,
      });
    }

    if (hasComputedAllData && this.payloadEnvelope) {
      this.computedDataPromise.resolve({
        payloadEnvelope: this.payloadEnvelope,
        columns: sampledColumns,
      });
    }
  }

  // Called when fork choice decides EMPTY variant of the block based on PTC votes
  // (> 50% PTC votes for payload absent). This typically happens ~1 slot after the block,
  // when the builder has had enough time to reveal but chose not to.
  // Marks data as complete even if payload and columns were expected but never arrived.
  // Idempotent - safe to call multiple times as PTC votes accumulate.
  markPayloadUnavailable(): void {
    if (!this.payloadAvailable) {
      return;
    }

    this.payloadAvailable = false;
    this.state = {
      ...this.state,
      hasAllData: true,
      hasComputedAllData: true, // No payload needed, so no reconstruction needed
      timeCompleteSec: Date.now() / 1000,
      payloadAvailable: false,
    } as BlockInputEpbsState;
    this.dataPromise.resolve(null);
    this.computedDataPromise.resolve(null);
  }

  hasPayloadEnvelope(): boolean {
    return this.payloadEnvelope !== null;
  }

  getPayloadEnvelope(): gloas.SignedExecutionPayloadEnvelope {
    if (!this.payloadEnvelope) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INCOMPLETE_DATA,
          ...this.getLogMeta(),
        },
        "Cannot get payload envelope. Payload is not available"
      );
    }
    return this.payloadEnvelope;
  }

  getPayloadEnvelopeOrNull(): gloas.SignedExecutionPayloadEnvelope | null {
    return this.payloadEnvelope;
  }

  hasColumn(columnIndex: number): boolean {
    return this.columnsCache.has(columnIndex);
  }

  getVersionedHashes(): VersionedHashes {
    // versionedHashes are only available when the block has arrived (from bid's blobKzgCommitments)
    return this.state.hasBlock ? this.state.versionedHashes : [];
  }

  getCustodyColumns(): gloas.DataColumnSidecars {
    const columns: gloas.DataColumnSidecars = [];
    for (const index of this.custodyColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar as gloas.DataColumnSidecar);
      }
    }
    return columns;
  }

  getSampledColumnsWithSource(): ColumnWithSource[] {
    const columns: ColumnWithSource[] = [];
    for (const index of this.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column);
      }
    }
    return columns;
  }

  getSampledColumns(): gloas.DataColumnSidecars {
    const columns: gloas.DataColumnSidecars = [];
    for (const index of this.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar as gloas.DataColumnSidecar);
      }
    }
    return columns;
  }

  getAllColumnsWithSource(): ColumnWithSource[] {
    return [...this.columnsCache.values()];
  }

  getAllColumns(): gloas.DataColumnSidecars {
    return this.getAllColumnsWithSource().map(({columnSidecar}) => columnSidecar as gloas.DataColumnSidecar);
  }

  getMissingSampledColumnMeta(): MissingColumnMeta {
    const versionedHashes = this.state.hasBlock ? this.state.versionedHashes : [];

    if (this.state.hasAllData) {
      return {
        missing: [],
        versionedHashes,
      };
    }

    const missing: number[] = [];
    for (const index of this.sampledColumns) {
      if (!this.columnsCache.has(index)) {
        missing.push(index);
      }
    }
    return {
      missing,
      versionedHashes,
    };
  }

  hasComputedAllData(): boolean {
    return this.state.hasComputedAllData;
  }

  waitForComputedAllData(timeout: number, signal?: AbortSignal): Promise<GloasDAData | null> {
    if (!this.state.hasComputedAllData) {
      return withTimeout(() => this.computedDataPromise.promise, timeout, signal);
    }

    if (this.payloadEnvelope) {
      const sampledColumns = this.getSampledColumns();
      return Promise.resolve({payloadEnvelope: this.payloadEnvelope, columns: sampledColumns});
    }
    return Promise.resolve(null);
  }
}
