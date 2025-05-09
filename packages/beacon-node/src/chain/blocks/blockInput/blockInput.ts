import {ForkName, ForkPreDeneb} from "@lodestar/params";
import {BlobIndex, ColumnIndex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {fromHex, prettyBytes, toHex, withTimeout} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {byteArrayEquals} from "../../../util/bytes.js";
import {BlockInputError, BlockInputErrorCode} from "./errors.js";
import {
  AddBlob,
  AddBlock,
  AddColumn,
  BlobMeta,
  BlobWithSource,
  BlockInputInit,
  ColumnMeta,
  ColumnWithSource,
  CreateBlockInputMeta,
  DAData,
  DAType,
  IBlockInput,
  LogMetaBasic,
  LogMetaBlobs,
  LogMetaColumns,
  PromiseParts,
  SourceMeta,
} from "./types.js";

export type BlockInput = BlockInputPreData | BlockInputBlobs | BlockInputColumns;

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
  timeCreated: number;

  forkName: ForkName;
  slot: Slot;
  blockRootHex: string;
  parentRootHex: string;

  abstract state: BlockInputState<F>;

  protected blockPromise = createPromise<SignedBeaconBlock<F>>();
  protected dataPromise = createPromise<TData>();

  constructor(init: BlockInputInit) {
    this.daOutOfRange = init.daOutOfRange;
    this.timeCreated = init.timeCreated;
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
      blockRoot: prettyBytes(this.blockRootHex),
      slot: this.slot,
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
  }

  static createFromBlock(props: AddBlock & CreateBlockInputMeta): BlockInputPreData {
    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.source.seenTimestampSec,
      forkName: props.forkName,
      slot: props.block.message.slot,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
    };
    const state: BlockInputPreDataState = {
      hasBlock: true,
      hasAllData: true,
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
      source: props.source,
      timeCompleteSec: hasAllData ? props.source.seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.source.seenTimestampSec,
      forkName: props.forkName,
      slot: props.block.message.slot,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
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
      expectedBlobs: this.state.hasBlock ? this.state.block.message.body.blobKzgCommitments.length : "unknown",
      receivedBlobs: this.blobsCache.size,
    };
  }

  addBlock({blockRootHex, block, source}: AddBlock<ForkBlobsDA>): void {
    if (!this.state.hasBlock) {
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

    const hasAllData = this.blobsCache.size === block.message.body.blobKzgCommitments.length;

    this.state = {
      ...this.state,
      hasAllData,
      block,
      versionedHashes: block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      source,
      timeCompleteSec: hasAllData ? source.seenTimestampSec : undefined,
    } as BlockInputBlobsState;
    this.blockPromise.resolve(block);
    if (hasAllData) {
      this.dataPromise.resolve(this.getBlobs());
    }
  }

  hasBlob(blobIndex: BlobIndex): boolean {
    return this.blobsCache.has(blobIndex);
  }

  addBlob({blockRootHex, blobSidecar, source, peerIdStr, seenTimestampSec}: AddBlob): void {
    if (this.state.hasAllData) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlob to BlockInputBlobs after it already is complete"
      );
    }
    if (this.blobsCache.has(blobSidecar.index)) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INVALID_CONSTRUCTION,
          blockRoot: this.blockRootHex,
        },
        "Cannot addBlob to BlockInputBlobs with duplicate blobIndex"
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

    if (this.state.hasBlock) {
      assertBlockAndBlobArePaired(this.blockRootHex, this.state.block, blobSidecar);
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
          versionHash: versionedHashes[index],
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
  return byteArrayEquals(block.message.body.blobKzgCommitments[blobSidecar.index], blobSidecar.kzgCommitment);
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
      versionedHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkColumnsDA>;
      source: SourceMeta;
      timeCompleteSec: number;
    }
  | {
      hasBlock: true;
      hasAllData: false;
      versionedHashes: VersionedHashes;
      block: SignedBeaconBlock<ForkColumnsDA>;
      source: SourceMeta;
    }
  | {
      hasBlock: false;
      hasAllData: true;
      versionedHashes: VersionedHashes;
    }
  | {
      hasBlock: false;
      hasAllData: false;
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

  static createFromBlock(
    props: AddBlock<ForkColumnsDA> &
      CreateBlockInputMeta & {sampledColumns: ColumnIndex[]; custodyColumns: ColumnIndex[]}
  ): BlockInputColumns {
    const hasAllData =
      props.daOutOfRange ||
      props.block.message.body.blobKzgCommitments.length === 0 ||
      props.sampledColumns.length === 0;
    const state = {
      hasBlock: true,
      hasAllData,
      versionedHashes: props.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      block: props.block,
      source: props.source,
      timeCreated: props.source.seenTimestampSec,
      timeCompleteSec: hasAllData ? props.source.seenTimestampSec : undefined,
    } as BlockInputColumnsState;
    const init: BlockInputInit = {
      daOutOfRange: props.daOutOfRange,
      timeCreated: props.source.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.block.message.parentRoot),
      slot: props.block.message.slot,
    };
    const blockInput = new BlockInputColumns(init, state, props.sampledColumns, props.custodyColumns);

    blockInput.blockPromise.resolve(props.block);
    if (hasAllData) {
      blockInput.dataPromise.resolve([]);
    }
    return blockInput;
  }

  static createFromColumn(
    props: AddColumn & CreateBlockInputMeta & {sampledColumns: ColumnIndex[]; custodyColumns: ColumnIndex[]}
  ): BlockInputColumns {
    const hasAllData = props.sampledColumns.length === 0;
    const state: BlockInputColumnsState = {
      hasBlock: false,
      hasAllData,
      versionedHashes: props.columnSidecar.kzgCommitments.map(kzgCommitmentToVersionedHash),
    };
    const init: BlockInputInit = {
      daOutOfRange: false,
      timeCreated: props.seenTimestampSec,
      forkName: props.forkName,
      blockRootHex: props.blockRootHex,
      parentRootHex: toHex(props.columnSidecar.signedBlockHeader.message.parentRoot),
      slot: props.columnSidecar.signedBlockHeader.message.slot,
    };
    const blockInput = new BlockInputColumns(init, state, props.sampledColumns, props.custodyColumns);
    if (hasAllData) {
      blockInput.dataPromise.resolve([]);
    }
    return blockInput;
  }

  getLogMeta(): LogMetaColumns {
    return {
      blockRoot: prettyBytes(this.blockRootHex),
      slot: this.slot,
      expectedColumns:
        this.state.hasBlock && this.state.block.message.body.blobKzgCommitments.length === 0
          ? 0
          : this.sampledColumns.length,
      receivedColumns: this.getSampledColumns().length,
    };
  }

  addBlock(props: AddBlock<ForkColumnsDA>): void {
    if (this.state.hasBlock) {
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

    const hasAllData = props.block.message.body.blobKzgCommitments.length === 0 || this.state.hasAllData;

    this.state = {
      ...this.state,
      hasBlock: true,
      hasAllData,
      block: props.block,
      source: props.source,
      timeCompleteSec: hasAllData ? props.source.seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    this.blockPromise.resolve(props.block);
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

    if (this.state.hasBlock) {
      assertBlockAndColumnArePaired(this.blockRootHex, this.state.block, columnSidecar);
    }

    this.columnsCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

    const sampledColumns = this.getSampledColumns();
    const hasAllData = this.state.hasAllData || sampledColumns.length === this.sampledColumns.length;

    this.state = {
      ...this.state,
      hasAllData: hasAllData || this.state.hasAllData,
      timeCompleteSec: hasAllData ? seenTimestampSec : undefined,
    } as BlockInputColumnsState;

    if (hasAllData && sampledColumns !== null) {
      this.dataPromise.resolve(sampledColumns);
    }
  }

  hasColumn(columnIndex: number): boolean {
    return this.columnsCache.has(columnIndex);
  }

  getVersionedHashes(): VersionedHashes {
    return this.state.versionedHashes;
  }

  getCustodyColumns(): fulu.DataColumnSidecars {
    const columns: fulu.DataColumnSidecars = [];
    for (const index of this.custodyColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar);
      }
    }
    return columns;
  }

  getSampledColumns(): fulu.DataColumnSidecars {
    const columns: fulu.DataColumnSidecars = [];
    for (const index of this.sampledColumns) {
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
    if (this.state.hasAllData) {
      return [];
    }

    const needed: ColumnMeta[] = [];
    const blockRoot = fromHex(this.blockRootHex);
    for (const index of this.sampledColumns) {
      if (!this.columnsCache.has(index)) {
        needed.push({index, blockRoot});
      }
    }
    return needed;
  }
}

function blockAndColumnArePaired(
  block: SignedBeaconBlock<ForkColumnsDA>,
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
  block: SignedBeaconBlock<ForkColumnsDA>,
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
