import {ForkName, ForkPostDeneb, ForkPostElectra, ForkPreDeneb} from "@lodestar/params";
import {BlobIndex, SignedBeaconBlock, Slot, deneb} from "@lodestar/types";
import {prettyBytes, toHex, withTimeout} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {byteArrayEquals} from "../../../util/bytes.js";
import {BlockInputError, BlockInputErrorCode} from "./errors.js";
import {
  AddBlobProps,
  AddBlockProps,
  BlobMeta,
  BlobWithSource,
  BlockInputBaseProps,
  BlockInputBlobsProps,
  BlockInputColumnsProps,
  BlockInputDataStatus,
  BlockInputPreDataProps,
  BlockInputType,
  BlockWithSource,
  ColumnWithSource,
  DataAvailabilityStatus,
  LogMetaBasic,
  LogMetaBlobs,
  LogMetaColumns,
  PossibleDataTypes,
  PromiseParts,
} from "./types.js";
import {prettyPrintArray} from "./utils.js";

type ColumnIndex = number;

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
  type: BlockInputType;
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

  constructor(props: BlockInputBaseProps | BlockInputPreDataProps<BlockType>) {
    this.type = BlockInputType.PreData;
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

  private createPromise<T>(): PromiseParts<T> {
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

  private checkForUndefinedProps(props: Record<string, unknown>): void {
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

  getVersionHashes(): VersionedHashes {
    if (!this.versionHashes || this.versionHashes.length !== this.numberOfBlobs()) {
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
    BlockType extends SignedBeaconBlock<ForkName.deneb> = SignedBeaconBlock<ForkName.deneb>,
    DataType extends PossibleDataTypes = deneb.BlobSidecars,
  >
  extends BlockInputData<BlockType, DataType>
  implements BlockInput<BlockType, DataType>
{
  type = BlockInputType.Blobs;
  protected blobsCache = new Map<BlobIndex, BlobWithSource>();

  constructor(props: BlockInputBlobsProps<BlockType>) {
    super(props);
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
    this.versionHashes = props.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
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
  getMissingBlobMeta(throwError: false): undefined | BlobMeta[];
  getMissingBlobMeta(throwError = true): undefined | BlobMeta[] {
    const blobMeta: BlobMeta[] = [];
    try {
      const versionHashes = this.getVersionHashes();
      for (let index = 0; index < versionHashes.length; index++) {
        if (!this.blobsCache.has(index)) {
          blobMeta.push({
            index,
            blockRoot: this.blockRoot,
            versionHash: versionHashes[index],
          });
        }
      }
    } catch (e) {
      if (throwError) {
        throw e;
      }
      return undefined;
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
          blockSlot: block.message.slot,
          mismatchedSlot: blobSidecar.signedBlockHeader.message.slot,
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
//     BlockType extends SignedBeaconBlock<ForkPostElectra> = SignedBeaconBlock<ForkPostElectra>,
//     DataType extends PossibleDataTypes = deneb.BlobSidecars,
//   >
//   extends BlockInputData<BlockType, DataType>
//   implements BlockInput<BlockType, DataType>
// {
//   type = BlockInputType.Columns;
//   protected columnsCache = new Map<ColumnIndex, ColumnWithSource>();

//   constructor(props: BlockInputColumnsProps<BlockType>) {
//     super(props);
//     this.type = BlockInputType.Columns;
//   }

//   getLogMeta(): LogMetaColumns {
//     return {
//       ...super.getLogMeta(),
//       expectedColumns: `${this.blockWithSource?.block.message.body.blobKzgCommitments.length}`,
//       receivedColumns: this.blobsCache.size,
//     };
//   }

//   hasData(): boolean {
//     return this.blobsCache.size !== 0;
//   }

//   needsData(): boolean {
//     return (
//       this.dataAvailability === DataAvailabilityStatus.Available &&
//       (!this.blockWithSource || this.columnsCache.size < this.custodyConfig.sampledColumns)
//     );
//   }

//   addBlock(props: AddBlockProps<BlockType>): void {
//     super.addBlock(props);
//   }
// }
