import {
  ForkName,
  ForkPostDeneb,
  ForkPostElectra,
  // ForkPostFulu,
  ForkPreDeneb,
} from "@lodestar/params";
import {
  BlobIndex,
  SignedBeaconBlock,
  Slot,
  deneb,
  // fulu
} from "@lodestar/types";
import {fromHex, prettyBytes, toHex, withTimeout} from "@lodestar/utils";
import {prettyPrintArray} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {byteArrayEquals} from "../../../util/bytes.js";
// import {CustodyConfig} from "../../../util/dataColumns.js";
import {BlockInputError, BlockInputErrorCode} from "./errors.js";
import {
  AddBlobProps,
  AddBlockProps,
  // AddColumnProps,
  BlobMeta,
  BlobWithSource,
  BlockInputBaseProps,
  BlockInputBlobsProps,
  // BlockInputColumnsProps,
  BlockInputDataStatus,
  BlockInputPreDataProps,
  BlockInputType,
  BlockWithSource,
  ColumnMeta,
  // ColumnWithSource,
  DataAvailabilityStatus,
  LogMetaBasic,
  LogMetaBlobs,
  // LogMetaColumns,
  PossibleDataTypes,
  PromiseParts,
} from "./types.js";

export interface BlockInput<
  BlockType extends SignedBeaconBlock = SignedBeaconBlock,
  DataType extends PossibleDataTypes = PossibleDataTypes,
> {
  type: BlockInputType;
  rootHex: string;
  blockRoot: Uint8Array;

  hasBlock(): boolean;
  getBlock(): BlockType;
  getBlockWithSource(): BlockWithSource<BlockType>;
  addBlock(props: AddBlockProps<BlockType>): void;
  removeBlock(): void;

  hasData(): boolean;
  needsData(): boolean;
  getDataStatus(): BlockInputDataStatus;
  isComplete(): boolean;
  numberOfBlobs(): number;

  getLogMeta(): LogMetaBasic;
  getForkName(): ForkName;
  getSlot(): Slot;
  getSlot(shouldError: false): Slot | undefined;
  getParentRootHex(): string;
  getParentRootHex(shouldError: false): string | undefined;

  waitForBlock(timeoutMs: number, abortSignal?: AbortSignal): Promise<BlockType>;
  waitForData(timeoutMs: number, abortSignal?: AbortSignal): Promise<DataType>;
  waitForBlockAndData(timeoutMs: number, abortSignal?: AbortSignal): Promise<BlockInput>;
}

export class BlockInputPreData<
  BlockType extends SignedBeaconBlock<ForkPreDeneb> = SignedBeaconBlock<ForkPreDeneb>,
  DataType extends PossibleDataTypes = null,
> implements BlockInput<BlockType, DataType>
{
  type = BlockInputType.PreData;
  rootHex: string;
  blockRoot: Uint8Array;

  protected slot?: Slot;
  protected forkName?: ForkName;
  protected parentRootHex?: string;
  protected blockWithSource?: BlockWithSource<BlockType>;
  protected dataAvailability: DataAvailabilityStatus = DataAvailabilityStatus.PreData;
  protected dataStatus: BlockInputDataStatus = BlockInputDataStatus.NoData;

  protected blockPromise = this.createPromise<BlockType>();
  protected dataPromise = this.createPromise<DataType>();

  protected timeCreatedSec?: number;
  protected timeCompleteSec?: number;

  get prettyRootHex(): string {
    return prettyBytes(this.rootHex);
  }

  constructor(props: BlockInputPreDataProps<BlockType>) {
    this.checkForUndefinedProps({
      rootHex: props.rootHex,
      blockRoot: props.blockRoot,
    });
    this.rootHex = props.rootHex;
    this.blockRoot = props.blockRoot;
    if ("block" in props) {
      this.timeCreatedSec = props.seenTimestampSec;
      this.addBlock(props);
    } else {
      this.timeCreatedSec = Date.now() / 1000;
    }
    this.dataPromise.resolve(null as DataType);
  }

  hasBlock(): boolean {
    return !!this.blockWithSource;
  }

  getBlock(): BlockType {
    return this.getBlockWithSource().block;
  }

  getBlockWithSource(): BlockWithSource<BlockType> {
    if (!this.blockWithSource) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_BLOCK, blockRoot: this.prettyRootHex});
    }
    return this.blockWithSource;
  }

  addBlock({
    rootHex,
    blockRoot,
    forkName,
    dataAvailability,
    block,
    source,
    seenTimestampSec,
    peerIdStr,
  }: AddBlockProps<BlockType>): void {
    this.checkForUndefinedProps({
      rootHex,
      blockRoot,
      forkName,
      dataAvailability,
      block,
      source,
      seenTimestampSec,
    });
    if (rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.rootHex,
          mismatchedRoot: rootHex,
          source,
          peerId: `${peerIdStr}`,
        },
        "Cannot addBlock to BlockInput with a different rootHex"
      );
    }

    this.forkName = forkName;
    this.dataAvailability = dataAvailability;
    this.blockWithSource = {
      block,
      source,
      seenTimestampSec,
      peerIdStr,
    };
    this.slot = block.message.slot;
    this.parentRootHex = toHex(block.message.parentRoot);

    this.blockPromise.resolve(block);

    if (!this.needsData()) {
      this.timeCompleteSec = Date.now();
    }
  }

  /**
   * Removes the block from the blockInput
   *
   * NOTE: It is best to run BlockInputCache.removeInvalidBlock instead of removeBlock
   * directly. That will also prune empty BlockInputs from the cache
   */
  removeBlock(): void {
    if (this.blockWithSource) {
      this.blockWithSource = undefined;
    }
  }

  hasData(): boolean {
    return false;
  }

  needsData(): boolean {
    return false;
  }

  isComplete(): boolean {
    return this.hasBlock() && !this.needsData();
  }

  numberOfBlobs(): number {
    throw new BlockInputError({
      code: BlockInputErrorCode.UNKNOWN_NUMBER_OF_BLOBS,
      ...this.getLogMeta(),
    });
  }

  getDataStatus(): BlockInputDataStatus {
    return this.dataStatus;
  }

  getLogMeta(): LogMetaBasic {
    return {
      blockRoot: this.prettyRootHex,
      slot: this.slot ?? "unknown",
    };
  }

  getForkName(): ForkName {
    if (!this.forkName) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_FORK_NAME, blockRoot: this.prettyRootHex});
    }
    return this.forkName;
  }

  getSlot(): Slot;
  getSlot(shouldError: false): Slot | undefined;
  getSlot(shouldError = true): Slot | undefined {
    if (shouldError && !this.slot) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_SLOT, blockRoot: this.prettyRootHex});
    }
    return this.slot;
  }

  getParentRootHex(): string;
  getParentRootHex(shouldError: false): string | undefined;
  getParentRootHex(shouldError = true): string | undefined {
    if (shouldError && !this.parentRootHex) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_PARENT_ROOT_HEX, blockRoot: this.prettyRootHex});
    }
    return this.parentRootHex;
  }

  getTimeComplete(): number {
    if (!this.timeCompleteSec) {
      throw new BlockInputError({
        code: BlockInputErrorCode.MISSING_TIME_COMPLETE,
        blockRoot: this.prettyRootHex,
      });
    }
    return this.timeCompleteSec;
  }

  async waitForBlock(timeoutMs: number, abortSignal?: AbortSignal): Promise<BlockType> {
    const signal = abortSignal ? abortSignal : new AbortController().signal;
    return withTimeout(() => this.blockPromise.promise, timeoutMs, signal);
  }

  async waitForData(timeoutMs: number, abortSignal?: AbortSignal): Promise<DataType> {
    const signal = abortSignal ? abortSignal : new AbortController().signal;
    return withTimeout(() => this.dataPromise.promise, timeoutMs, signal);
  }

  async waitForBlockAndData(timeoutMs: number, abortSignal?: AbortSignal): Promise<BlockInput> {
    const signal = abortSignal ? abortSignal : new AbortController().signal;
    await withTimeout(() => Promise.all([this.blockPromise.promise, this.dataPromise.promise]), timeoutMs, signal);
    return this;
  }

  protected createPromise<T>(): PromiseParts<T> {
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

  protected checkForUndefinedProps(props: Record<string, unknown>): void {
    for (const [propName, value] of Object.entries(props)) {
      if (value === undefined) {
        throw new BlockInputError({
          code: BlockInputErrorCode.UNDEFINED_PROP,
          blockRoot: this.rootHex,
          propName,
        });
      }
    }
  }
}

abstract class BlockInputData<BlockType extends SignedBeaconBlock<ForkPostDeneb>, DataType extends PossibleDataTypes>
  extends BlockInputPreData<BlockType, DataType>
  implements BlockInput<BlockType, DataType>
{
  protected versionHashes?: VersionedHashes;

  addBlock(props: AddBlockProps<BlockType>): void {
    this.versionHashes = props.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
    super.addBlock(props);
  }

  getVersionHashes(): VersionedHashes;
  getVersionHashes(shouldError: false): undefined | VersionedHashes;
  getVersionHashes(shouldError = true): undefined | VersionedHashes {
    if (!this.versionHashes || this.versionHashes.length !== this.numberOfBlobs()) {
      if (!shouldError) {
        return;
      }
      throw new BlockInputError({
        code: BlockInputErrorCode.MISSING_VERSIONED_HASHES,
        blockRoot: this.prettyRootHex,
      });
    }
    return this.versionHashes;
  }

  numberOfBlobs(): number {
    if (!this.blockWithSource) {
      throw new BlockInputError({
        code: BlockInputErrorCode.UNKNOWN_NUMBER_OF_BLOBS,
        ...this.getLogMeta(),
      });
    }
    return this.blockWithSource.block.message.body.blobKzgCommitments.length;
  }
}

export class BlockInputBlobs<
    BlockType extends SignedBeaconBlock<ForkPostDeneb> = SignedBeaconBlock<ForkPostDeneb>,
    DataType extends PossibleDataTypes = deneb.BlobSidecars,
  >
  extends BlockInputData<BlockType, DataType>
  implements BlockInput<BlockType, DataType>
{
  type = BlockInputType.Blobs;
  protected blobsCache = new Map<BlobIndex, BlobWithSource>();

  constructor(props: BlockInputBlobsProps<BlockType>) {
    super(props);
    if ("block" in props && "blobSidecar" in props) {
      throw new BlockInputError({code: BlockInputErrorCode.INVALID_CONSTRUCTION, blockRoot: this.prettyRootHex});
    }
    if ("blobSidecar" in props) {
      this.addBlob(props);
    }
  }

  getLogMeta(): LogMetaBlobs {
    return {
      ...super.getLogMeta(),
      expectedBlobs: `${this.blockWithSource?.block.message.body.blobKzgCommitments.length}`,
      receivedBlobs: this.blobsCache.size,
    };
  }

  hasData(): boolean {
    return this.blobsCache.size !== 0;
  }

  needsData(): boolean {
    return (
      this.dataAvailability === DataAvailabilityStatus.Available &&
      (!this.blockWithSource || this.blobsCache.size < this.numberOfBlobs())
    );
  }

  addBlock(props: AddBlockProps<BlockType>): void {
    if (props.rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.rootHex,
          mismatchedRoot: props.rootHex,
          source: props.source,
          peerId: `${props.peerIdStr}`,
        },
        "addBlock rootHex does not match BlockInput.rootHex"
      );
    }
    for (const {blobSidecar} of this.blobsCache.values()) {
      const err = this.checkBlockAndBlobArePaired(props.block, blobSidecar);
      if (err) {
        this.blobsCache.delete(blobSidecar.index);
        // TODO: (@matthewkeil) spec says to ignore invalid blobs but should we downscore the peer maybe?
        // this.logger?.error(`Removing blobIndex=${blobSidecar.index} from BlockInput`, {}, err);
      }
    }

    super.addBlock(props);
  }

  hasBlob(blobIndex: BlobIndex): boolean {
    return this.blobsCache.has(blobIndex);
  }

  addBlob({rootHex, blobSidecar, source, seenTimestampSec, peerIdStr}: AddBlobProps): void {
    if (rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.rootHex,
          mismatchedRoot: rootHex,
          source: source,
          peerId: `${peerIdStr}`,
        },
        "Blob BeaconBlockHeader rootHex does not match BlockInput.rootHex"
      );
    }
    this.checkForUndefinedProps({rootHex, blobSidecar, source, seenTimestampSec});

    if (this.blockWithSource) {
      const err = this.checkBlockAndBlobArePaired(this.blockWithSource.block, blobSidecar);
      if (err) throw err;
    }

    // TODO: (@matthewkeil) check for duplicates and add metric here
    // if (this.blobsCache.has(blobSidecar.index)) {
    //   this.metrics.blockInput.duplicateBlob.inc()
    // }

    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, seenTimestampSec, peerIdStr});

    if (!this.needsData()) {
      this.dataStatus = BlockInputDataStatus.CompleteData;
      this.dataPromise.resolve(this.getAllBlobs() as DataType);
      if (this.hasBlock()) {
        this.timeCompleteSec = seenTimestampSec;
      }
    } else if (this.dataStatus === BlockInputDataStatus.NoData) {
      this.dataStatus = BlockInputDataStatus.IncompleteData;
    }
  }

  /**
   * Removes a blob from the blockInput
   *
   * NOTE: It is best to run BlockInputCache.removeInvalidBlock instead of removeBlock
   * directly. That will also prune empty BlockInputs from the cache
   */
  removeBlob(blobIndex: BlobIndex): void {
    this.blobsCache.delete(blobIndex);
  }

  getMissingBlobMeta(): BlobMeta[];
  getMissingBlobMeta(shouldError: false): undefined | BlobMeta[];
  getMissingBlobMeta(shouldError = true): undefined | BlobMeta[] {
    const blobMeta: BlobMeta[] = [];
    // The call would have succeeded against this implementation, but implementation
    // signatures of overloads on extended classes are not externally visible. Need
    // to cast `as false` to build
    const versionHashes = this.getVersionHashes(shouldError as false);
    if (!versionHashes) return;
    for (let index = 0; index < versionHashes.length; index++) {
      if (!this.blobsCache.has(index)) {
        blobMeta.push({
          index,
          blockRoot: this.blockRoot,
          versionHash: versionHashes[index],
        });
      }
    }
    return blobMeta;
  }

  getAllBlobsWithSource(): BlobWithSource[] {
    if (this.dataAvailability === DataAvailabilityStatus.OutOfRange) {
      return [];
    }
    if (this.needsData()) {
      const missingIndices = this.getMissingBlobMeta(false)?.map(({index}) => index);
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.INCOMPLETE_DATA,
          ...this.getLogMeta(),
        },
        `Cannot get all blobs.  Missing blob indices ${missingIndices ? prettyPrintArray(missingIndices) : "[ unknown ]"}`
      );
    }
    return [...this.blobsCache.values()];
  }

  getAllBlobs(): deneb.BlobSidecars {
    return this.getAllBlobsWithSource().map(({blobSidecar}) => blobSidecar);
  }

  private checkBlockAndBlobArePaired(
    block: SignedBeaconBlock<ForkName.deneb>,
    blobSidecar: deneb.BlobSidecar
  ): void | BlockInputError {
    if (block.message.slot !== blobSidecar.signedBlockHeader.message.slot) {
      return new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_SLOT,
          blockRoot: this.prettyRootHex,
          blockInputSlot: this.getSlot(false),
          blockSlot: block.message.slot,
          sidecarSlot: blobSidecar.signedBlockHeader.message.slot,
        },
        "Block and blob have mismatched slots"
      );
    }

    if (!byteArrayEquals(block.message.body.blobKzgCommitments[blobSidecar.index], blobSidecar.kzgCommitment)) {
      // TODO: (@matthewkeil) should this eject the bad blob instead? No way to tell if the blob or the block
      //       has the invalid commitment. Guessing it would be the blob though because we match via block
      //       hashTreeRoot and we do not take a hashTreeRoot of the BlobSidecar
      return new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
          blockRoot: this.rootHex,
          slot: block.message.slot,
          sidecarIndex: blobSidecar.index,
        },
        "BlobSidecar commitment does not match block commitment"
      );
    }
  }
}

// export class BlockInputColumns<
//     BlockType extends SignedBeaconBlock<ForkPostFulu> = SignedBeaconBlock<ForkPostFulu>,
//     DataType extends PossibleDataTypes = fulu.DataColumnSidecars,
//   >
//   extends BlockInputData<BlockType, DataType>
//   implements BlockInput<BlockType, DataType>
// {
//   type = BlockInputType.Columns;
//   protected columnsCache = new Map<ColumnIndex, ColumnWithSource>();
//   protected readonly custodyConfig: CustodyConfig;

//   constructor(props: BlockInputColumnsProps<BlockType>) {
//     super(props);
//     this.custodyConfig = props.custodyConfig;
//     if ("block" in props && "columnSidecar" in props) {
//       throw new BlockInputError({code: BlockInputErrorCode.INVALID_CONSTRUCTION, blockRoot: this.prettyRootHex});
//     }
//     if ("columnSidecar" in props) {
//       this.addColumn(props);
//     }
//   }

//   getLogMeta(): LogMetaColumns {
//     return {
//       ...super.getLogMeta(),
//       expectedColumns: this.custodyConfig.sampledColumns.length,
//       receivedColumns: this.getSampledColumns(false).length,
//     };
//   }

//   hasData(): boolean {
//     return this.columnsCache.size !== 0;
//   }

//   needsData(): boolean {
//     return this.dataAvailability === DataAvailabilityStatus.Available && !!this.getMissingColumnMeta().length;
//   }

//   addBlock(props: AddBlockProps<BlockType>): void {
//     if (props.rootHex !== this.rootHex) {
//       throw new BlockInputError(
//         {
//           code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
//           blockInputRoot: this.rootHex,
//           mismatchedRoot: props.rootHex,
//           source: props.source,
//           peerId: `${props.peerIdStr}`,
//         },
//         "addBlock rootHex does not match BlockInput.rootHex"
//       );
//     }

//     for (const {columnSidecar} of this.columnsCache.values()) {
//       const err = this.checkBlockAndColumnArePaired(props.block, columnSidecar);
//       if (err) {
//         this.columnsCache.delete(columnSidecar.index);
//         // this.logger?.error(`Removing columnIndex=${columnSidecar.index} from BlockInput`, {}, err);
//       }
//     }

//     super.addBlock(props);
//   }

//   addColumn({rootHex, columnSidecar, source, seenTimestampSec, peerIdStr}: AddColumnProps): void {
//     if (rootHex !== this.rootHex) {
//       throw new BlockInputError(
//         {
//           code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
//           blockInputRoot: this.rootHex,
//           mismatchedRoot: rootHex,
//           source: source,
//           peerId: `${peerIdStr}`,
//         },
//         "Column BeaconBlockHeader rootHex does not match BlockInput.rootHex"
//       );
//     }
//     this.checkForUndefinedProps({rootHex, columnSidecar, source, seenTimestampSec});

//     if (this.blockWithSource) {
//       if (this.blockWithSource.block.message.body.blobKzgCommitments.length === 0) {
//         throw new BlockInputError(
//           {
//             code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
//             blockRoot: this.rootHex,
//             slot: this.getSlot(),
//             sidecarIndex: columnSidecar.index,
//           },
//           "Block has no kzg commitments but DataColumnSidecar was received"
//         );
//       }

//       const err = this.checkBlockAndColumnArePaired(this.blockWithSource.block, columnSidecar);
//       if (err) {
//         throw err;
//       }
//     }

//     this.columnsCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

//     if (this.getMissingColumnMeta().length === 0) {
//       this.dataStatus = BlockInputDataStatus.CompleteData;
//       // TODO: (@matthewkeil) should this resolve the sampled or custody columns?
//       this.dataPromise.resolve(this.getSampledColumns() as DataType);
//       if (this.hasBlock()) {
//         this.timeCompleteSec = seenTimestampSec;
//       }
//     } else if (this.dataStatus === BlockInputDataStatus.NoData) {
//       this.dataStatus = BlockInputDataStatus.IncompleteData;
//     }
//   }

//   hasColumn(columnIndex: number): boolean {
//     return this.columnsCache.has(columnIndex);
//   }

//   getCustodyColumns = this.makeColumnsGetter("custody").bind(this);

//   getSampledColumns = this.makeColumnsGetter("sampled").bind(this);

//   getAllColumnsWithSource(): ColumnWithSource[] {
//     return [...this.columnsCache.values()];
//   }

//   getAllColumns(): fulu.DataColumnSidecars {
//     return this.getAllColumnsWithSource().map(({columnSidecar}) => columnSidecar);
//   }

//   getMissingColumnMeta(): ColumnMeta[] {
//     const needed: ColumnMeta[] = [];
//     for (const index of this.custodyConfig.sampledColumns) {
//       if (!this.columnsCache.has(index)) {
//         needed.push({index, blockRoot: this.blockRoot});
//       }
//     }
//     return needed;
//   }

//   private checkBlockAndColumnArePaired(block: BlockType, columnSidecar: fulu.DataColumnSidecar): void | Error {
//     if (block.message.slot !== columnSidecar.signedBlockHeader.message.slot) {
//       return new BlockInputError(
//         {
//           code: BlockInputErrorCode.MISMATCHED_SLOT,
//           blockRoot: this.prettyRootHex,
//           blockInputSlot: this.getSlot(false),
//           blockSlot: block.message.slot,
//           sidecarSlot: columnSidecar.signedBlockHeader.message.slot,
//         },
//         `Block and column have mismatched slots. blockSlot=${block.message.slot} columnSlot=${columnSidecar.signedBlockHeader.message.slot}`
//       );
//     }

//     const expectedCommitments = block.message.body.blobKzgCommitments;

//     // check for 0 length of sidecar commitments happens in `verifyDataColumnSidecar` when they are
//     // received via gossip or reqresp
//     if (expectedCommitments.length !== columnSidecar.kzgCommitments.length) {
//       return new BlockInputError(
//         {
//           code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT_LENGTH,
//           blockRoot: this.rootHex,
//           slot: this.getSlot(false),
//           columnIndex: columnSidecar.index,
//           blockCommitments: expectedCommitments.length,
//           sidecarCommitments: columnSidecar.kzgCommitments.length,
//         },
//         "DataColumnSidecar commitment length does not match block commitment length"
//       );
//     }

//     for (let index = 0; index < expectedCommitments.length; index++) {
//       if (!byteArrayEquals(expectedCommitments[index], columnSidecar.kzgCommitments[index])) {
//         return new BlockInputError(
//           {
//             code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
//             blockRoot: this.rootHex,
//             slot: this.getSlot(false),
//             sidecarIndex: columnSidecar.index,
//             commitmentIndex: index,
//           },
//           "DataColumnsSidecar kzgCommitment does not match block kzgCommitment"
//         );
//       }
//     }
//   }

//   private makeColumnsGetter(type: "custody" | "sampled"): (throwError?: boolean) => fulu.DataColumnSidecars {
//     return (throwError = true) => {
//       const requested: fulu.DataColumnSidecars = [];
//       const missing: number[] = [];
//       for (const index of this.custodyConfig[`${type}Columns`]) {
//         const cachedColumn = this.columnsCache.get(index);
//         if (cachedColumn) {
//           requested.push(cachedColumn.columnSidecar);
//         } else {
//           missing.push(index);
//         }
//       }
//       if (missing.length && throwError) {
//         throw new BlockInputError(
//           {
//             code: BlockInputErrorCode.INCOMPLETE_DATA,
//             ...this.getLogMeta(),
//           },
//           `Missing ${type} columns=${prettyPrintArray(missing)}`
//         );
//       }
//       return requested;
//     };
//   }
// }
