import {ForkBlobs, ForkName, ForkPostDeneb, ForkPostFulu, ForkPreDeneb, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {fromHex, LodestarError, Logger, prettyBytes, toHex, withTimeout} from "@lodestar/utils";
import {kzgCommitmentToVersionedHash, VersionHash} from "../../../util/blobs.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {DataAvailabilityStatus, MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {PeerIdStr} from "../../../util/peerId.js";
import {Metrics} from "../../../metrics/metrics.js";

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

// export type BlockInputCoreProps = {
//   metrics?: Metrics;
//   abortSignal?: AbortSignal;
// };
// export type BlockInputSource = {
//   source: BlockInputSourceType;
//   peerIdStr: string;
// };
// export type CachedBlob = BlockInputSource & {
//   blobSidecar: deneb.BlobSidecar;
// };
// export type CachedColumn = BlockInputSource & {
//   columnSidecar: fulu.DataColumnSidecar;
// };
// export type BlockInputBlobsProps = CachedBlob & {blockRoot: Uint8Array};
// export type BlockInputColumnProps = CachedBlob & {blockRoot: Uint8Array};

// export type CreateBlockInputCoreProps = {
//   logger: Logger;
//   metrics?: Metrics;
//   abortSignal?: AbortSignal;
//   source: BlockInputSourceType;
//   peerIdStr?: string;
// };
// type BlockInputConstructorCoreProps = Omit<CreateBlockInputCoreProps, "abortSignal" | "source" | "peerIdStr"> & {
//   blockRoot: Uint8Array;
//   rootHex: string;
//   forkName: ForkName;
// };
// type BlockInputPreDenebConstructorProps = BlockInputConstructorCoreProps & {
//   block?: SignedBeaconBlock<ForkPreDeneb>;
// };
// type BlockInputBlobsConstructorProps = BlockInputConstructorCoreProps & {
//   block?: SignedBeaconBlock<ForkBlobs>;
//   blobSidecar?: deneb.BlobSidecar;
// };
// type BlockInputColumnsConstructorProps = BlockInputConstructorCoreProps & {
//   block?: SignedBeaconBlock<ForkPostFulu>;
//   columnSidecar?: fulu.DataColumnSidecar;
// };

// export type CreateBlockInputBlockRootProps = {blockRoot: Uint8Array; slot?: Slot};
// export type CreateBlockInputBlockProps<T> = CreateBlockInputCoreProps & {block: SignedBeaconBlock<T>};
// export type CreateBlockInputBlobProps = CreateBlockInputCoreProps & {blobSidecar: deneb.BlobSidecar};
// export type CreateBlockInputColumnProps = CreateBlockInputCoreProps & {columnSidecar: fulu.DataColumnSidecar};

type CoreBlockInputProps = {
  logger?: Logger;
  metrics?: Metrics;
};
type CreateFromRootHexProps = CoreBlockInputProps & {
  rootHex: string;
  slot?: Slot;
  forkName?: ForkName;
};
type AddBlockProps = {
  block: SignedBeaconBlock;
  blockRoot: Uint8Array;
  rootHex: string;
  forkName: ForkName;
  source: BlockInputSourceType;
  peerIdStr?: PeerIdStr;
};
type CreateFromBlockProps = CoreBlockInputProps & AddBlockProps;
type BlockInputConstructorProps = CreateFromRootHexProps & Partial<CreateFromBlockProps>;

// type AddBlobProps = {};
type BlockInputBlobsConstructorProps = BlockInputConstructorProps & {blobSidecar: deneb.BlobSidecar};
// type AddColumnProps = {};
type BlockInputColumnsConstructorProps = BlockInputConstructorProps & {columnSidecar: fulu.DataColumnSidecar};

type CreateFromBlobProps = BlockInputConstructorProps & {blobSidecar: deneb.BlobSidecar};
type CreateFromColumnProps = BlockInputConstructorProps & {columnSidecar: fulu.DataColumnSidecar};

type BlockWithSource<T> = {
  block: T;
  source: BlockInputSourceType;
  peerIdStr?: string;
};

type AddBlockProps<T> = BlockWithSource<T> & {
  blockRoot: Uint8Array;
  rootHex: string;
};

export abstract class BlockInput<BlockType = SignedBeaconBlock<ForkPreDeneb>, DataType = void> {
  type: BlockInputType;
  blockRoot: Uint8Array;
  rootHex: string;
  dataAvailability: DataAvailabilityStatus;
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

  static createFromRootHex(props: CreateFromRootHexProps): BlockInput {
    return new BlockInput(props);
  }

  static createFromBlock(props: CreateFromBlockProps): BlockInput {
    return new BlockInput(props);
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

  getBlock(): BlockType {
    if (!this.blockWithSource) {
      throw new BlockInputError({code: BlockInputErrorCode.NO_BLOCK_TO_GET});
    }
    return this.blockWithSource.block;
  }

  addBlock({rootHex, blockRoot, block, forkName, source, peerIdStr}: AddBlockProps): void {
    if (rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.blockRoot,
          mismatchedRoot: blockRoot,
        },
        "Invalid attempted to addBlock"
      );
    }

    if (!forkName) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_FORK_NAME, rootHex});
    }
    this.forkName = forkName;

    if (!source) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_SOURCE, rootHex});
    }
    this.blockWithSource = {
      block,
      source,
      peerIdStr,
    };
    this.slot = block.message.slot;
    this.parentRootHex = toHex(block.message.parentRoot);

    this.blockPromise.resolve(block);
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

  /**
   * Removes a blob from the blockInput
   *
   * NOTE: It is best to run BlockInputCache.removeInvalidBlob instead of removeBlob
   * directly. That will also prune empty BlockInput from the cache
   */
  removeBlob(_blobSidecar: deneb.BlobSidecar): void {
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

  protected constructor(props: BlockInputConstructorProps) {
    const {rootHex, blockRoot, slot, forkName, logger, metrics, block} = props;
    this.rootHex = rootHex;
    this.blockRoot = blockRoot ? blockRoot : fromHex(rootHex);
    this.slot = slot;
    this.forkName = forkName;
    this.logger = logger;
    this.metrics = metrics;

    if (block) {
      this.addBlock(props as AddBlockProps);
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
}

export class BlockInputPreDeneb extends BlockInput {
  type: BlockInputType.PreDeneb;
  dataAvailability = DataAvailabilityStatus.PreData;
  protected dataStatus = BlockInputDataStatus.NoData;

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
  protected blobsCache: Map<number, CachedBlob>;

  static createFromBlock(props: CreateFromBlockProps): BlockInputBlobs {
    return new BlockInputBlobs(props);
  }

  static createFromBlobSidecar({
    metrics,
    abortSignal,
    blockRoot,
    blobSidecar,
    source,
    peerIdStr,
  }: CreateFromBlobProps): BlockInputBlobs {
    return BlockInputBlobs({blockRoot, blobSidecar, forkName, metrics});
  }

  protected constructor(props: BlockInputBlobsConstructorProps) {
    super(props);
    if (props.blobSidecar) {
      this.addBlob(props.blobSidecar, props.source, props.peerIdStr);
    }
  }
  // TODO: should this get overloaded and check that commitments match the blobs
  // addBlock(): void {
  //   super.addBlock()
  //   for (const blob of this.blobsCache.values()) {
  //     if (this.block.message.body.blobKzgCommitments[blob.index] !== blob.kzgCommitment) {
  //       throw new Error()
  //     }
  //   }
  // }

  async waitForBlock(timeout: number): Promise<SignedBeaconBlock<ForkBlobs>> {
    return super.waitForBlock(timeout);
  }

  addBlock(): void {
    this.blockWithSource = {};
  }

  addBlob(blobSidecar: deneb.BlobSidecar, source: BlockInputSourceType, peerIdStr?: string): void {
    if (blockRoot !== this.blockRoot) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.blockRoot,
          mismatchedRoot: blockRoot,
          source,
          peerId: peerIdStr,
        },
        "Invalid attempted to addBlob"
      );
    }
    // TODO: figure out this condition correctly
    if (this.blobsCache.hasBlob(blobSidecar)) {
      // TODO: not sure if this should throw here or maybe collect a metric. Saw a note about
      //       handling this case but this is newly added
    } else {
    }
    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, peerIdStr});
    if (this.blockWithSource) {
      const numberOfBlobs = this.blobsCache.size();
      const numberOfCommitments = this.blockWithSource.message.body.blobKzgCommitments.length;
      if (numberOfBlobs > numberOfCommitments) {
        // Should loop though commitments to figure out which index doesn't match block commitments?
        throw new BlockInputError({
          code: BlockInputErrorCode.TOO_MANY_RECEIVED_BLOBS,
          numberOfCommitments,
          numberOfBlobs,
          slot: this.blockWithSource.message.slot,
          blockRoot,
        });
      }
      // TODO: should this get checked that the commitment is contained in the block?
      if (numberOfBlobs === numberOfCommitments) {
        this.dataPromise.resolve([...this.blobsCache.values()]);
      }
    }
  }

  /**
   * Removes a blob from the blockInput
   *
   * NOTE: It is best to run BlockInputCache.removeInvalidBlock instead of removeBlock
   * directly. That will also prune empty BlockInputs from the cache
   */
  removeBlob(blobIndex: number): void {
    this.blobsCache.delete(blobIndex);
  }

  getBlobs(): deneb.BlobSidecars {}

  getMissingBlobIndices(): undefined | MissingBlob[] {
    if (!this.blockWithSource) {
      return undefined;
    }

    const commitments = this.blockWithSource.message.body.blobKzgCommitments;

    const blobsMeta: MissingBlob[] = [];
    for (let index = 0; index < commitments.length; index++) {
      if (!this.blobsCache.has(index)) {
        blobsMeta.push({
          index,
          blockRoot: this.blockRoot,
          versionHash: kzgCommitmentToVersionedHash(commitments[index]),
        });
      }
    }

    return blobsMeta;
  }

  getLogMeta(): BlockInputDataLogMeta {
    return {
      ...super.getLogMeta(),
      dataType: BlockInputType.Blobs,
      expected: `${this.blockWithSource?.block.message.body.blobKzgCommitments.length}`,
      received: this.blobsCache.size(),
    };
  }

  protected constructor({
    metrics,
    abortSignal,
    blockRoot,
    blobSidecar,
    source,
    peerIdStr,
  }: BlockInputCoreProps & BlockInputBlobsProps) {
    super({metrics, abortSignal, blockRoot});
    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, peerIdStr});
  }
}

export class BlockInputColumns extends BlockInput {
  type: BlockInputType.Columns;
  custodyConfig: CustodyConfig;
  protected blockWithSource: SignedBeaconBlock<ForkPostFulu>;
  protected columnsCache: Map<number, CachedColumn>;

  static createFromBlock({}: CreateFromBlockProps): BlockInputColumns {}

  static createFromColumnSidecar({}: CreateFromColumnProps): BlockInputColumns {
    return BlockInputColumns({blockRoot, columnSidecar, forkName});
  }

  addColumnSidecar(columnSidecar: fulu.DataColumnSidecar, source: BlockInputSourceType, peerIdStr?: string): void {
    if (this.blockRoot !== blockRoot || this.slot !== columnSidecar.signedBlockHeader.message.slot) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.blockRoot,
          mismatchedRoot: blockRoot,
          source,
          peerId: peerIdStr,
        },
        "Invalid attempted to addColumn"
      );
    }
    // TODO: not sure if this should throw here.  Saw and note about handling this case but this is newly added
    // if (this.columnsCache.get(columnSidecar.index)) {
    //   throw new BlockInputError({code: BlockInputErrorCode.ALREADY_SEEN_COLUMN, index: columnSidecar.index});
    // }
    this.columnsCache.set(columnSidecar.index, {columnSidecar, source, peerIdStr});
    if (
      this.blockWithSource &&
      this.blockWithSource.message.body.blobKzgCommitments.length === this.columnsCache.size()
    ) {
      this.dataPromise.resolve([...this.columnsCache.values()]);
    }
  }

  needData(): boolean {
    return this.getMissingColumnIndices().length;
  }

  getMissingColumnIndices(): MissingData[] {
    const needed: MissingData[] = [];
    for (const index of this.columnsCache.keys()) {
      if (!this.custodyConfig.sampledColumns.includes(index)) {
        needed.push({index, blockRoot: this.rootHex});
      }
    }
    return needed;
  }

  getAllColumns(): fulu.DataColumnSidecars {
    return [...this.columnsCache.values()].map(({columnSidecar}) => columnSidecar);
  }

  getCustodyIndex(): Uint8Array {
    return this.custodyConfig.custodyColumnsIndex;
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

  protected constructor({
    blockRoot,
    columnSidecar,
    forkName,
  }: {blockRoot: RootHex; columnSidecar: deneb.BlobSidecar; forkName: ForkName}) {
    super(blockRoot, undefined, forkName);
    this.columnsCache.set(columnSidecar.index, columnSidecar);
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
  dataAvailabilityStatus: DataAvailabilityStatus;
  /** Seen timestamp seconds */
  seenTimestampSec: number;
};

enum BlockInputErrorCode {
  MISMATCHED_BLOCK_ROOT = "BLOCK_INPUT_ERROR_MISMATCHED_BLOCK_ROOT",
  AWAIT_DATA_PRE_DENEB = "BLOCK_INPUT_ERROR_CANNOT_AWAIT_DATA_PRE_DENEB",
  ALREADY_SEEN_BLOB = "BLOCK_INPUT_ERROR_ALREADY_SEEN_BLOB",
  TOO_MANY_RECEIVED_BLOBS = "BLOCK_INPUT_ERROR_TOO_MANY_RECEIVED_BLOBS",
  ALREADY_SEEN_COLUMN = "BLOCK_INPUT_ERROR_ALREADY_SEEN_COLUMN",
  NO_BLOCK_TO_GET = "BLOCK_INPUT_NO_BLOCK_TO_GET",
  NO_FORK_NAME_TO_GET = "BLOCK_INPUT_NO_FORK_NAME_TO_GET",
  NO_SLOT_TO_GET = "BLOCK_INPUT_NO_SLOT_TO_GET",
  NO_PARENT_ROOT_HEX_TO_GET = "BLOCK_INPUT_NO_PARENT_ROOT_HEX_TO_GET",
  INCOMPLETE_DATA = "BLOCK_INPUT_INCOMPLETE_DATA",
  MISMATCH_BLOCK_INPUT_TYPE = "BLOCK_INPUT_ERROR_MISMATCH_BLOCK_INPUT_TYPE",
  MISSING_SOURCE = "BLOCK_INPUT_ERROR_MISSING_SOURCE",
  MISSING_FORK_NAME = "BLOCK_INPUT_ERROR_MISSING_FORK_NAME",
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
      code: BlockInputErrorCode.MISSING_SOURCE | BlockInputErrorCode.MISSING_FORK_NAME;
      rootHex: string;
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
