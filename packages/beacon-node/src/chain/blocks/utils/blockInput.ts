import {ForkBlobs, ForkName, ForkPostDeneb, ForkPostFulu, ForkPreDeneb, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {BlobIndex, ColumnIndex, Epoch, RootHex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {fromHex, LodestarError, Logger, prettyBytes, toHex, withTimeout} from "@lodestar/utils";
import {kzgCommitmentToVersionedHash, VersionHash} from "../../../util/blobs.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {DataAvailabilityStatus, MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {PeerIdStr} from "../../../util/peerId.js";
import {Metrics} from "../../../metrics/metrics.js";
import {byteArrayEquals} from "../../../util/bytes.js";

type PromiseParts<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
};

/**
 * Represents were input originated. Blocks and Data can come from different
 * sources so each should be labelled individually.
 */
export enum BlockInputSourceType {
  gossip = "gossip",
  api = "api",
  engine = "engine",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
}
export enum BlockInputType {
  PreDeneb = "pre-deneb",
  Blobs = "blobs",
  Columns = "columns",
}
export enum BlockInputDataStatus {
  NoData = "no_data",
  IncompleteData = "incomplete_data",
  CompleteData = "complete_data",
}

type MissingData = {
  blockRoot: Uint8Array;
  index: number;
};
type MissingBlob = MissingData & {
  versionHash: VersionHash;
};

type BlockInputLogMeta = {
  blockRoot: RootHex;
  slot: Slot | string;
};
type BlockInputDataLogMeta = BlockInputLogMeta & {
  type: BlockInputType;
  expected: number;
  received: number;
};

type CoreBlockInputProps = {
  logger?: Logger;
  metrics?: Metrics;
};
type CreateFromRootHexProps = CoreBlockInputProps & {
  rootHex: RootHex;
  blockRoot?: Uint8Array;
  slot?: Slot;
  forkName?: ForkName;
};
type BlockWithSource<T> = {
  block: T;
  source: BlockInputSourceType;
  seenTimestampSec: number;
  peerIdStr?: string;
};
type AddBlockProps<BlockType> = BlockWithSource<BlockType> & {
  blockRoot: Uint8Array;
  rootHex: RootHex;
  forkName: ForkName;
  dataAvailability?: DataAvailabilityStatus;
};
type CreateFromBlockProps<BlockType> = CoreBlockInputProps & AddBlockProps<BlockType>;
type BlockInputConstructorProps<BlockType> = CreateFromRootHexProps & Partial<CreateFromBlockProps<BlockType>>;

type BlobWithSource = {
  blobSidecar: deneb.BlobSidecar;
  source: BlockInputSourceType;
  seenTimestampSec: number;
  peerIdStr?: string;
};
type AddBlobProps = BlobWithSource & {
  rootHex: RootHex;
};
type CreateFromBlobProps = CoreBlockInputProps &
  AddBlobProps & {
    blockRoot: Uint8Array;
    forkName: ForkName;
  };

type ColumnWithSource = {
  columnSidecar: fulu.DataColumnSidecar;
  source: BlockInputSourceType;
  seenTimestampSec: number;
  peerIdStr?: string;
};
type AddColumnProps = ColumnWithSource & {
  rootHex: RootHex;
};
type CreateFromColumnProps = CoreBlockInputProps &
  AddColumnProps & {
    blockRoot: Uint8Array;
    forkName: ForkName;
  };

export abstract class BlockInput<BlockType = SignedBeaconBlock, DataType = void> {
  type: BlockInputType;
  blockRoot: Uint8Array;
  rootHex: string;
  dataAvailability: DataAvailabilityStatus;
  timeFirstSeenSec: number;
  protected timeCompleteSec: number;
  protected slot?: Slot;
  protected forkName?: ForkName;
  protected parentRootHex?: RootHex;
  protected dataStatus: BlockInputDataStatus = BlockInputDataStatus.NoData;
  protected blockWithSource?: BlockWithSource<BlockType>;
  protected blockPromise = this.createPromise<BlockType>();
  protected dataPromise = this.createPromise<DataType>();
  protected readonly logger?: Logger;
  protected readonly metrics?: Metrics;

  get prettyRootHex(): string {
    return prettyBytes(this.rootHex);
  }

  getLogMeta(): {blockRoot: string; slot: string} {
    return {
      blockRoot: this.prettyRootHex,
      slot: this.slot ?? "unknown",
    };
  }

  getForkName(): ForkName {
    if (!this.forkName) {
      throw new BlockInputError({code: BlockInputErrorCode.NO_FORK_NAME_TO_GET});
    }
    return this.forkName;
  }

  getSlot<T extends boolean = true, R extends T extends true ? Slot : Slot | undefined>(shouldError: T = true): R {
    if (shouldError && !this.slot) {
      throw new BlockInputError({code: BlockInputErrorCode.NO_SLOT_TO_GET});
    }
    return this.slot;
  }

  setSlot(slot: Slot): void {
    this.slot = slot;
  }

  getParentRootHex(): string {
    if (!this.parentRootHex) {
      throw new BlockInputError({code: BlockInputErrorCode.NO_PARENT_ROOT_HEX_TO_GET});
    }
    return this.parentRootHex;
  }

  hasBlock(): boolean {
    return !!this.blockWithSource;
  }

  getBlock(): BlockWithSource<BlockType> {
    if (!this.blockWithSource) {
      throw new BlockInputError({code: BlockInputErrorCode.NO_BLOCK_TO_GET});
    }
    return this.blockWithSource;
  }

  addBlock({
    rootHex,
    blockRoot,
    block,
    forkName,
    source,
    seenTimestampSec,
    peerIdStr,
    dataAvailability,
  }: AddBlockProps<BlockType>): void {
    if (rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.blockRoot,
          mismatchedRoot: blockRoot,
        },
        "Cannot addBlock to BlockInput with a different blockRoot"
      );
    }
    this.checkForUndefinedProps({forkName, source, seenTimestamp: seenTimestampSec});

    this.forkName = forkName;
    this.blockWithSource = {
      block,
      source,
      seenTimestampSec: seenTimestampSec,
      peerIdStr,
    };
    this.slot = block.message.slot;
    this.parentRootHex = toHex(block.message.parentRoot);
    this.dataAvailability = dataAvailability
      ? dataAvailability
      : isBlockInputPreDeneb(this)
        ? DataAvailabilityStatus.PreData
        : DataAvailabilityStatus.Available;

    this.blockPromise.resolve(block);

    if (!this.needData()) {
      this.timeCompleteSec = seenTimestampSec;
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
    return (
      this.dataStatus === BlockInputDataStatus.IncompleteData || this.dataStatus === BlockInputDataStatus.CompleteData
    );
  }

  needData(): boolean {
    return this.dataAvailability === DataAvailabilityStatus.OutOfRange
      ? false
      : this.dataStatus !== BlockInputDataStatus.CompleteData;
  }

  isComplete(): boolean {
    return !this.needData() && this.hasBlock();
  }

  getTimeComplete(): number {
    if (!this.timeCompleteSec) {
      throw new BlockInputError({code: BlockInputErrorCode.INCOMPLETE_DATA, ...this.getLogMeta()});
    }
    return this.timeCompleteSec;
  }

  numberOfBlobs(): number {
    throw new BlockInputError({
      code: BlockInputErrorCode.NUMBER_OF_BLOBS_NOT_AVAILABLE,
      blockRoot: this.rootHex,
      slot: `${this.getSlot(false)}`,
    });
  }

  /**
   * Removes a blob from the blockInput
   *
   * NOTE: It is best to run BlockInputCache.removeInvalidBlob instead of removeBlob
   * directly. That will also prune empty BlockInput from the cache
   */
  removeBlobSidecar(_blobSidecar: deneb.BlobSidecar): void {
    throw new BlockInputError({
      code: BlockInputErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
      actualType: this.type,
      expectedType: BlockInputType.Blobs,
    });
  }

  /**
   * Removes the block from the blockInput
   *
   * NOTE: It is best to run BlockInputCache.removeInvalidBlock instead of removeBlock
   * directly. That will also prune empty BlockInputs from the cache
   */
  removeColumn(_columnSidecar: fulu.DataColumnSidecar): void {
    throw new BlockInputError({
      code: BlockInputErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
      actualType: this.type,
      expectedType: BlockInputType.Columns,
    });
  }

  async waitForBlock(timeout: number, abortSignal?: AbortSignal): Promise<BlockType> {
    const signal = abortSignal ? abortSignal : new AbortController().signal;
    return withTimeout(() => this.blockPromise.promise, timeout, signal);
  }

  async waitForData(timeout: number, abortSignal?: AbortSignal): Promise<DataType> {
    const signal = abortSignal ? abortSignal : new AbortController().signal;
    return withTimeout(() => this.dataPromise.promise, timeout, signal);
  }

  async waitForBlockAndData(timeout: number, abortSignal?: AbortSignal): Promise<BlockInput> {
    const signal = abortSignal ? abortSignal : new AbortController().signal;
    await withTimeout(() => Promise.all([this.blockPromise.promise, this.dataPromise.promise]), timeout, signal);
    return this;
  }

  protected constructor(props: BlockInputConstructorProps<BlockType>) {
    const {rootHex, blockRoot, slot, forkName, logger, metrics, block, seenTimestampSec} = props;
    this.rootHex = rootHex;
    this.blockRoot = blockRoot ? blockRoot : fromHex(rootHex);
    this.slot = slot;
    this.forkName = forkName;
    this.logger = logger;
    this.metrics = metrics;
    this.timeFirstSeen = seenTimestampSec ?? Date.now() / 1000;

    if (block) {
      this.addBlock(props);
    }
  }

  private createPromise<T>(): PromiseParts<T> {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (e: Error) => void;
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

export class BlockInputPreDeneb<BlockType = SignedBeaconBlock<ForkPreDeneb>, DataType = void> extends BlockInput<
  BlockType,
  DataType
> {
  type: BlockInputType.PreDeneb;
  dataAvailability = DataAvailabilityStatus.PreData;
  protected dataStatus = BlockInputDataStatus.NoData;

  static createFromRootHex(props: CreateFromRootHexProps): BlockInput {
    return new BlockInput(props);
  }

  static createFromBlock(props: CreateFromBlockProps<BlockType>): BlockInput {
    return new BlockInputPreDeneb(props);
  }

  waitForData(_timeout: number, _abortSignal?: AbortSignal) {
    return this.dataPromise.promise;
    // TODO: should this throw?
    // throw new BlockInputError({code: BlockInputErrorCode.AWAIT_DATA_PRE_DENEB});
  }

  async waitForBlockAndData(timeout: number, abortSignal?: AbortSignal): Promise<BlockInput> {
    await this.waitForBlock(timeout, abortSignal);
    return this;
  }

  // TODO: figure out this upgrade path for unknown block syncs
  upgradeToBlobs(): BlockInputBlobs {
    const blockInputBlobs = BlockInputBlobs.createFromRootHex(this.rootHex, this.metrics);
    if (this.blockWithSource) {
      blockInputBlobs.addBlock(this.blockWithSource);
    }
    return blockInputBlobs;
  }

  // TODO: figure out this upgrade path for unknown block syncs
  upgradeToColumns(): BlockInputColumns {
    const blockInputColumns = BlockInputColumns.createFromRootHex(this.rootHex, this.metrics);
    if (this.blockWithSource) {
      blockInputColumns.addBlock(this.blockWithSource);
    }
    return blockInputColumns;
  }

  constructor(props: BlockInputConstructorProps) {
    super(props);
    this.dataPromise.resolve(void);
  }
}

export class BlockInputBlobs extends BlockInput<SignedBeaconBlock<ForkBlobs>, deneb.BlobSidecars> {
  type: BlockInputType.Blobs;
  protected blobsCache: Map<BlobIndex, BlobWithSource>;
  protected versionHashes?: VersionHash;
  protected expectedBlobs?: number;

  static createFromRootHex(props: CreateFromRootHexProps): BlockInputBlobs {
    return new BlockInputBlobs(props);
  }

  static createFromBlock(props: CreateFromBlockProps<SignedBeaconBlock<ForkBlobs>>): BlockInputBlobs {
    return new BlockInputBlobs(props);
  }

  static createFromBlobSidecar(props: CreateFromBlobProps): BlockInputBlobs {
    return new BlockInputBlobs(props);
  }

  protected constructor(
    props: BlockInputConstructorProps<SignedBeaconBlock<ForkBlobs>> & {blobSidecar?: deneb.BlobSidecar}
  ) {
    super(props);
    if (props.blobSidecar && props.block) {
      throw new BlockInputError(
        {code: BlockInputErrorCode.INVALID_PROPS, blockRoot: this.rootHex, slot: `${this.getSlot(false)}`},
        "Cannot add both block and a blob through BlockInput constructor. Must them separately so source and peerId can be recorded for each"
      );
    }
    if (props.blobSidecar) {
      this.addBlobSidecar({
        rootHex: props.rootHex,
        blobSidecar: props.blobSidecar,
        source: props.source,
        peerIdStr: props.peerIdStr,
      });
    }
  }

  addBlock(props: AddBlockProps<SignedBeaconBlock<ForkBlobs>>): void {
    if (props.rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.rootHex,
          mismatchedRoot: props.rootHex,
          source: props.source,
          peerId: props.peerIdStr,
        },
        "Blob BeaconBlockHeader rootHex does not match BlockInput.rootHex"
      );
    }
    for (const {blobSidecar} of this.blobsCache.values()) {
      const err = this.checkBlockAndBlobArePaired(props.block, blobSidecar);
      if (err) {
        this.blobsCache.delete(blobSidecar.index);
        this.logger?.error(`Removing blobIndex=${blobSidecar.index} from BlockInput`, {}, err);
      }
    }
    super.addBlock(props);
    this.expectedBlobs = props.block.message.body.blobKzgCommitments.length;
    this.versionHashes = props.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
  }

  addBlobSidecar({rootHex, blobSidecar, source, seenTimestampSec, peerIdStr}: AddBlobProps): void {
    if (rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.rootHex,
          mismatchedRoot: rootHex,
          source,
          peerId: peerIdStr,
        },
        "Blob BeaconBlockHeader rootHex does not match BlockInput.rootHex"
      );
    }

    if (this.blockWithSource) {
      const err = this.checkBlockAndBlobArePaired(this.blockWithSource.block, blobSidecar);
      if (err) {
        throw err;
      }
    }

    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, seenTimestampSec, peerIdStr});

    if (this.expectedBlobs && this.expectedBlobs === this.blobsCache.size()) {
      // // TODO: (@matthewkeil) found this in the code but the check above for matching commitments should prevent this
      // //       probably should get deleted but leaving here for now
      // const numberOfBlobs = this.blobsCache.size();
      // if (numberOfBlobs > this.expectedBlobs) {
      //   // TODO: (@matthewkeil) Should we loop though commitments to figure out which index doesn't match block commitments
      //   //       and down-score peer?
      //   throw new BlockInputError({
      //     code: BlockInputErrorCode.TOO_MANY_RECEIVED_BLOBS,
      //     numberOfCommitments: this.expectedBlobs,
      //     ...this.getLogMeta(),
      //   });
      // }
      this.dataStatus = BlockInputDataStatus.CompleteData;
      this.dataPromise.resolve([...this.blobsCache.values()]);
      if (this.hasBlock()) {
        this.timeCompleteSec = seenTimestampSec;
      }
    } else {
      this.dataStatus = BlockInputDataStatus.IncompleteData;
    }
  }

  /**
   * Removes a blob from the blockInput
   *
   * NOTE: It is best to run BlockInputCache.removeInvalidBlock instead of removeBlock
   * directly. That will also prune empty BlockInputs from the cache
   */
  removeBlobSidecar(blobIndex: number): void {
    this.blobsCache.delete(blobIndex);
  }

  hasBlobSidecar(blobIndex: number): boolean {
    return this.blobsCache.has(blobIndex);
  }

  getMissingBlobIndices(): undefined | MissingBlob[] {
    if (!this.blockWithSource) {
      return undefined;
    }

    const blobsMeta: MissingBlob[] = [];
    const commitments = this.blockWithSource.message.body.blobKzgCommitments;

    for (let index = 0; index < commitments.length; index++) {
      if (!this.blobsCache.has(index)) {
        const versionHash = this.versionHashes[index];
        // this should never be the case. perhaps non-null assertion is better here?
        if (!versionHash) {
          throw new BlockInputError({
            code: BlockInputErrorCode.MISSING_VERSION_HASH,
            blockRoot: this.rootHex,
            blobIndex: index,
          });
        }
        blobsMeta.push({
          index,
          blockRoot: this.blockRoot,
          versionHash,
        });
      }
    }

    return blobsMeta;
  }

  getAllBlobs(): BlobWithSource[] {
    if (this.dataAvailability === DataAvailabilityStatus.OutOfRange) return [];
    if (this.needData()) {
      throw new BlockInputError(
        {code: BlockInputErrorCode.INCOMPLETE_DATA, ...this.getLogMeta()},
        "Cannot getAllBlobs"
      );
    }
    return [...this.blobsCache.values()];
  }

  getVersionHashes(): VersionHash[] {
    if (!this.versionHashes) {
      throw new BlockInputError({
        code: BlockInputErrorCode.MISSING_VERSION_HASH,
        blockRoot: this.rootHex,
        blobIndex: 0,
      });
    }
    return this.versionHashes;
  }

  numberOfBlobs(): number {
    if (!this.versionHashes) {
      throw new BlockInputError({
        code: BlockInputErrorCode.NUMBER_OF_BLOBS_NOT_AVAILABLE,
        blockRoot: this.rootHex,
        slot: `${this.getSlot(false)}`,
      });
    }
    return this.versionHashes;
  }

  getLogMeta(): BlockInputDataLogMeta {
    return {
      ...super.getLogMeta(),
      dataType: BlockInputType.Blobs,
      expected: `${this.blockWithSource?.block.message.body.blobKzgCommitments.length}`,
      received: this.blobsCache.size(),
    };
  }

  private checkBlockAndBlobArePaired(
    block: SignedBeaconBlock<ForkBlobs>,
    blobSidecar: deneb.BlobSidecar
  ): undefined | Error {
    if (block.message.slot !== blobSidecar.signedBlockHeader.message.slot) {
      return new BlockInputError(
        {code: BlockInputErrorCode.MISMATCHED_SLOT, blockRoot: this.rootHex, blockInputSlot: this.slot},
        `Block and commitment have mismatched slots. blockSlot=${block.message.slot} blobSlot=${blobSidecar.signedBlockHeader.message.slot}`
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

export class BlockInputColumns extends BlockInput<SignedBeaconBlock<ForkPostFulu>, fulu.DataColumnSidecars> {
  type: BlockInputType.Columns;
  custodyConfig: CustodyConfig;
  protected columnsCache: Map<ColumnIndex, ColumnWithSource>;
  protected versionHashes?: VersionHash;

  static createFromRootHex(props: CreateFromRootHexProps): BlockInputColumns {
    return new BlockInputColumns(props);
  }

  static createFromBlock(props: CreateFromBlockProps<SignedBeaconBlock<ForkPostFulu>>): BlockInputColumns {
    return new BlockInputColumns(props);
  }

  static createFromColumnSidecar(props: CreateFromColumnProps): BlockInputColumns {
    return BlockInputColumns(props);
  }

  protected constructor(
    props: BlockInputConstructorProps<SignedBeaconBlock<ForkPostFulu>> & {columnsSidecar?: fulu.DataColumnSidecar}
  ) {
    super(props);
    if (props.columnsSidecar && props.block) {
      throw new BlockInputError(
        {code: BlockInputErrorCode.INVALID_PROPS, blockRoot: this.rootHex, slot: `${this.getSlot(false)}`},
        "Cannot add both block and a column through BlockInput constructor. Must them separately so source and peerId can be recorded for each"
      );
    }
    if (props.columnsSidecar) {
      this.addColumnSidecar({
        rootHex: props.rootHex,
        columnSidecar: props.columnsSidecar,
        source: props.source,
        peerIdStr: props.peerIdStr,
      });
    }
  }

  addBlock(props: AddBlockProps<SignedBeaconBlock<ForkPostFulu>>): void {
    if (props.rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.rootHex,
          mismatchedRoot: props.rootHex,
          source: props.source,
          peerId: props.peerIdStr,
        },
        "Column BeaconBlockHeader rootHex does not match BlockInput.rootHex"
      );
    }

    for (const {columnSidecar} of this.columnsCache.values()) {
      const err = this.checkBlockAndBlobArePaired(props.block, columnSidecar);
      if (err) {
        this.columnsCache.delete(columnSidecar.index);
        this.logger?.error(`Removing columnIndex=${columnSidecar.index} from BlockInput`, {}, err);
      }
    }

    super.addBlock(props);
    this.versionHashes = props.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
  }

  addColumnSidecar({rootHex, columnSidecar, source, seenTimestampSec, peerIdStr}: AddColumnProps): void {
    if (rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.rootHex,
          mismatchedRoot: rootHex,
          source,
          peerId: peerIdStr,
        },
        "Column BeaconBlockHeader rootHex does not match BlockInput.rootHex"
      );
    }

    if (this.blockWithSource) {
      if (this.blockWithSource.block.message.body.blobKzgCommitments.length === 0) {
        throw new BlockInputError(
          {
            code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
            blockRoot: this.rootHex,
            slot: columnSidecar.signedBlockHeader.message.slot,
            sidecarIndex: columnSidecar.index,
          },
          "Block has no kzg commitments but DataColumnSidecar was received"
        );
      }

      const err = this.checkBlockAndColumnArePaired(
        this.blockWithSource.block.message.body.blobKzgCommitments,
        columnSidecar
      );
      if (err) {
        throw err;
      }
    }

    this.columnsCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

    if (this.getMissingColumnIndices().length === 0) {
      this.dataStatus = BlockInputDataStatus.CompleteData;
      // TODO: (@matthewkeil) should this resolve the sampled or custody columns?
      this.dataPromise.resolve([...this.getSampledColumns()]);
      if (this.hasBlock()) {
        this.timeCompleteSec = seenTimestampSec;
      }
    } else {
      this.dataStatus === BlockInputDataStatus.IncompleteData;
    }
  }

  hasColumn(columnIndex: number): boolean {
    return this.columnsCache.has(columnIndex);
  }

  needData(): boolean {
    return this.getMissingColumnIndices().length;
  }

  getMissingColumnIndices(): MissingData[] {
    const needed: MissingData[] = [];
    for (const index of this.custodyConfig.sampledColumns) {
      if (!this.columnsCache.has(index)) {
        needed.push({index, blockRoot: this.rootHex});
      }
    }
    return needed;
  }

  getAllColumns(): fulu.DataColumnSidecars {
    return [...this.columnsCache.values()].map(({columnSidecar}) => columnSidecar);
  }

  getVersionHashes(): VersionHash[] {
    if (!this.versionHashes) {
      throw new BlockInputError({
        code: BlockInputErrorCode.MISSING_VERSION_HASH,
        blockRoot: this.rootHex,
        blobIndex: 0,
      });
    }
    return this.versionHashes;
  }

  getCustodyIndex(): Uint8Array {
    return this.custodyConfig.custodyColumnsIndex;
  }

  numberOfBlobs(): number {
    if (!this.versionHashes) {
      throw new BlockInputError({
        code: BlockInputErrorCode.NUMBER_OF_BLOBS_NOT_AVAILABLE,
        blockRoot: this.rootHex,
        slot: `${this.getSlot(false)}`,
      });
    }
    return this.versionHashes;
  }

  getCustodyColumns = this.makeColumnsGetter("custody").bind(this);

  getSampledColumns = this.makeColumnsGetter("sampled").bind(this);

  getLogMeta(): BlockInputDataLogMeta {
    return {
      ...super.getLogMeta(),
      dataType: BlockInputType.Columns,
      expected: this.custodyConfig.sampledColumns.length,
      received: this.columnsCache.size(),
    };
  }

  private checkBlockAndColumnArePaired(
    block: SignedBeaconBlock<ForkPostFulu>,
    columnSidecar: fulu.DataColumnSidecar
  ): undefined | Error {
    if (block.message.slot !== columnSidecar.signedBlockHeader.message.slot) {
      return new BlockInputError(
        {code: BlockInputErrorCode.MISMATCHED_SLOT, blockRoot: this.rootHex, blockInputSlot: this.slot},
        `Block and column have mismatched slots. blockSlot=${block.message.slot} columnSlot=${columnSidecar.signedBlockHeader.message.slot}`
      );
    }

    const expectedCommitments = block.message.body.blobKzgCommitments;

    // check for 0 length of sidecar commitments happens in `verifyDataColumnSidecar` when they are
    // received via gossip or reqresp
    if (expectedCommitments.length !== columnSidecar.kzgCommitments.length) {
      return new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
          blockRoot: this.rootHex,
          slot: this.getSlot(),
          columnIndex: columnSidecar.index,
          blockCommitments: expectedCommitments.length,
          sidecarCommitments: columnSidecar.kzgCommitments.length,
        },
        "DataColumnSidecar commitment length does not match block commitment length"
      );
    }

    for (let index = 0; index < expectedCommitments.length; index++) {
      if (!byteArrayEquals(expectedCommitments[index], columnSidecar.kzgCommitments[index])) {
        return new BlockInputError(
          {
            code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
            blockRoot: this.rootHex,
            slot: this.getSlot(),
            columnSidecarIndex: columnSidecar.index,
            commitmentIndex: index,
          },
          "DataColumnsSidecar kzgCommitment does not match block kzgCommitment"
        );
      }
    }
  }

  private makeColumnsGetter(type: "custody" | "sampled"): (throwError?: boolean) => fulu.DataColumnSidecars {
    return (throwError = true) => {
      const requested: fulu.DataColumnSidecars = [];
      const missing: number[] = [];
      for (const index of this.custodyConfig[`${type}Columns`]) {
        const cachedColumn = this.columnsCache.get(index);
        if (cachedColumn) {
          requested.push(cachedColumn.columnSidecar);
        } else {
          missing.push(index);
        }
      }
      if (missing.length && throwError) {
        throw new BlockInputError(
          {
            code: BlockInputErrorCode.INCOMPLETE_DATA,
            ...this.getLogMeta(),
          },
          `Missing ${type} columns=[ ${missing.concat(", ")} ]`
        );
      }
      return requested;
    };
  }
}

export function isBlockInputPreDeneb(blockInput: BlockInput): blockInput is BlockInputPreDeneb {
  return blockInput.type === BlockInputType.PreDeneb;
}

export function isBlockInputBlobs(blockInput: BlockInput): blockInput is BlockInputBlobs {
  return blockInput.type === BlockInputType.Blobs;
}

export function isBlockInputColumns(blockInput: BlockInput): blockInput is BlockInputColumns {
  return blockInput.type === BlockInputType.Columns;
}

/**
 * A wrapper around a `SignedBeaconBlock` that indicates that this block is fully verified and ready to import
 */
export type FullyVerifiedBlock = {
  blockInput: BlockInput;
  postState: CachedBeaconStateAllForks;
  parentBlockSlot: Slot;
  proposerBalanceDelta: number;
  /**
   * If the execution payload couldnt be verified because of EL syncing status,
   * used in optimistic sync or for merge block
   */
  executionStatus: MaybeValidExecutionStatus;
};

enum BlockInputErrorCode {
  // Bad args passed to a method
  INVALID_PROPS = "BLOCK_INPUT_ERROR_INVALID_PROPS",
  // Missing args passed to a method
  UNDEFINED_PROP = "BLOCK_INPUT_ERROR_UNDEFINED_PROP",

  MISMATCHED_SLOT = "BLOCK_INPUT_ERROR_MISMATCHED_SLOT",
  MISMATCHED_BLOCK_ROOT = "BLOCK_INPUT_ERROR_MISMATCHED_BLOCK_ROOT",
  MISMATCHED_KZG_COMMITMENT = "BLOCK_INPUT_ERROR_MISMATCHED_KZG_COMMITMENT",

  AWAIT_DATA_PRE_DENEB = "BLOCK_INPUT_ERROR_CANNOT_AWAIT_DATA_PRE_DENEB",

  ALREADY_SEEN_BLOB = "BLOCK_INPUT_ERROR_ALREADY_SEEN_BLOB",
  TOO_MANY_RECEIVED_BLOBS = "BLOCK_INPUT_ERROR_TOO_MANY_RECEIVED_BLOBS",
  ALREADY_SEEN_COLUMN = "BLOCK_INPUT_ERROR_ALREADY_SEEN_COLUMN",

  NO_BLOCK_TO_GET = "BLOCK_INPUT_NO_BLOCK_TO_GET",

  NUMBER_OF_BLOBS_NOT_AVAILABLE = "BLOCK_INPUT_ERROR_NUMBER_OF_BLOBS_NOT_AVAILABLE",

  /**
   * Invalid construction checks
   */
  NO_SLOT_TO_GET = "BLOCK_INPUT_NO_SLOT_TO_GET",
  NO_FORK_NAME_TO_GET = "BLOCK_INPUT_NO_FORK_NAME_TO_GET",
  NO_PARENT_ROOT_HEX_TO_GET = "BLOCK_INPUT_NO_PARENT_ROOT_HEX_TO_GET",

  INCOMPLETE_DATA = "BLOCK_INPUT_INCOMPLETE_DATA",
  MISMATCH_BLOCK_INPUT_TYPE = "BLOCK_INPUT_ERROR_MISMATCH_BLOCK_INPUT_TYPE",

  MISSING_VERSION_HASH = "BLOCK_INPUT_ERROR_MISSING_VERSION_HASH",

  // MISSING_FORK_NAME = "BLOCK_INPUT_ERROR_MISSING_FORK_NAME",
  // MISSING_SOURCE = "BLOCK_INPUT_ERROR_MISSING_SOURCE",
}

type BlockInputErrorType =
  | {
      code:
        | BlockInputErrorCode.AWAIT_DATA_PRE_DENEB
        | BlockInputErrorCode.NO_BLOCK_TO_GET
        | BlockInputErrorCode.NO_SLOT_TO_GET
        | BlockInputErrorCode.NO_PARENT_ROOT_HEX_TO_GET;
    }
  | {
      code: BlockInputErrorCode.MISSING_VERSION_HASH;
      blockRoot: RootHex;
      blobIndex: number;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_SLOT;
      blockRoot: RootHex;
      blockInputSlot: Slot;
    }
  | {
      code: BlockInputErrorCode.UNDEFINED_PROP;
      propName: string;
      blockRoot: RootHex;
    }
  // | {
  //     code: BlockInputErrorCode.MISSING_SOURCE | BlockInputErrorCode.MISSING_FORK_NAME;
  //     blockRoot: string;
  //   }
  | {
      code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT;
      blockRoot: RootHex;
      slot: Slot;
      sidecarIndex: number;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT;
      blockRoot: RootHex;
      slot: Slot;
      columnIndex: number;
      blockCommitments: number;
      sidecarCommitments: number;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT;
      blockRoot: RootHex;
      slot: Slot;
      columnSidecarIndex: number;
      commitmentIndex: number;
    }
  | {
      code: BlockInputErrorCode.INVALID_PROPS | BlockInputErrorCode.NUMBER_OF_BLOBS_NOT_AVAILABLE;
      blockRoot: string;
      slot: string | Slot;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT;
      blockInputRoot: RootHex;
      mismatchedRoot: RootHex;
      source?: BlockInputSourceType;
      peerId?: string;
    }
  | {
      code: BlockInputErrorCode.ALREADY_SEEN_BLOB;
      seenIndex: number;
    }
  | {
      code: BlockInputErrorCode.ALREADY_SEEN_COLUMN;
      seenIndex: number;
    }
  | {
      code: BlockInputErrorCode.TOO_MANY_RECEIVED_BLOBS;
      numberOfCommitments: number;
      numberOfBlobs: number;
      slot: Slot;
      blockRoot: RootHex;
    }
  | {
      code: BlockInputErrorCode.INCOMPLETE_DATA;
      blockRoot: RootHex;
      slot: Slot;
      type: BlockInputType;
      expected: number;
      received: number;
    }
  | {
      code: BlockInputErrorCode.MISMATCH_BLOCK_INPUT_TYPE;
      actualType: BlockInputType;
      expectedType: BlockInputType;
    };

class BlockInputError extends LodestarError<BlockInputErrorType> {}
