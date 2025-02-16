import {ChainForkConfig} from "@lodestar/config";
import {ForkBlobs, ForkName, ForkPostFulu} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {LodestarError, withTimeout} from "@lodestar/utils";
import {Metrics} from "../../../metrics.js";
import {kzgCommitmentToVersionedHash, VersionHash} from "../../../util/blobs.js";

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
export type BlockInputCoreProps = {
  config: ChainForkConfig;
  metrics?: Metrics;
  abortSignal?: AbortSignal;
};
export type BlockInputSource = {
  source: BlockInputSource;
  peerIdStr: string;
};
export type CachedBlob = BlockInputSource & {
  blobSidecar: deneb.BlobSidecar;
};
export type CachedColumn = BlockInputSource & {
  columnSidecar: fulu.DataColumnSidecar;
};
export type BlockInputBlobsProps = CachedBlob & {blockRoot: Uint8Array};
export type BlockInputColumnProps = CachedBlob & {blockRoot: Uint8Array};

type PromiseParts<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
};

export enum BlockInputStatus {
  NO_BLOCK_NO_DATA = "no_block_no_data",
  MO_BLOCK_INCOMPLETE_DATA = "no_block_incomplete_data",
  MO_BLOCK_COMPLETE_DATA = "no_block_complete_data",
  HAVE_BLOCK_NO_DATA = "have_block_no_data",
  HAVE_BLOCK_INCOMPLETE_DATA = "have_block_incomplete_data",
  COMPLETE = "complete",
}

export abstract class BlockInput<T = void> {
  type: BlockInputType;
  blockRoot: Uint8Array;
  rootHex: string;
  slot?: Slot;
  parentRootHex?: RootHex;
  status: BlockInputStatus;
  forkName?: ForkName;
  protected block?: SignedBeaconBlock;
  protected blockPromise = this.createPromise<SignedBeaconBlock>();
  protected dataPromise = this.createPromise<T>();
  protected readonly config: ChainForkConfig;
  protected readonly metrics?: Metrics;

  // TODO: do we really need this?
  protected abortSignal: AbortSignal;

  static createFromBlock(block: SignedBeaconBlock, config: ChainForkConfig, metrics?: Metrics): BlockInput {
    const forkName = config.getForkName(block.message.slot);
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    return new BlockInput({blockRoot, block, forkName});
  }

  static createFromRootHex(blockRoot: Uint8Array): BlockInput {
    return new BlockInput({blockRoot});
  }

  getBlock(): SignedBeaconBlock {
    if (!this.block) {
      throw new BlockInputError({code: BlockInputErrorCode.NO_BLOCK_TO_GET});
    }
    return this.block;
  }

  addBlock(block: SignedBeaconBlock): void {
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    if (blockRoot !== this.blockRoot) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.blockRoot,
          mismatchedRoot: blockRoot,
        },
        "Invalid attempted to addBlock"
      );
    }
    this.forkName = config.getForkName(block.message.slot);
    this.block = block;
    this.blockPromise.resolve(block);
  }

  needBlock(): boolean {
    return !this.block;
  }

  needData(): boolean {
    return false;
  }

  async waitForBlock(timeout: number): Promise<SignedBeaconBlock> {
    return withTimeout(() => this.blockPromise.promise, timeout, this.abortSignal);
  }

  async waitForData(timeout: number): Promise<T> {
    return withTimeout(() => this.dataPromise.promise, timeout, this.abortSignal);
  }

  async waitForBlockAndData(timeout: number): Promise<BlockInput> {
    await withTimeout(
      () => Promise.all([this.blockPromise.promise, this.dataPromise.promise]),
      timeout,
      this.abortSignal
    );
    return this;
  }

  getLogMeta(): {blockRoot: string; slot: string} {
    return {
      blockRoot: this.rootHex,
      slot: this.slot ?? "unknown",
    };
  }

  abstract getMeta(): Record<string, string | number>;

  protected constructor({
    blockRoot,
    block,
    forkName,
    abortSignal,
    metrics,
  }: {
    blockRoot: Uint8Array;
    block?: SignedBeaconBlock;
    forkName?: ForkName;
    abortSignal?: AbortSignal;
    metrics?: Metrics;
  }) {
    this.blockRoot = blockRoot;
    this.block = block;
    this.forkName = forkName;
    this.metrics = metrics;
    if (abortSignal) {
      this.abortSignal = abortSignal;
      this.abortSignal.addEventListener("abort", () => this.stop(), {once: true});
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

export class BlockInputPreDeneb extends BlockInput<void> {
  type: BlockInputType.PreDeneb;
  waitForData(): Promise<void> {
    throw new BlockInputError({code: BlockInputErrorCode.AWAIT_DATA_PRE_DENEB});
  }

  async waitForBlockAndData(): Promise<BlockInput> {
    await this.waitForBlock();
    return this;
  }

  upgradeToBlobs(): BlockInputBlobs {
    const blockInputBlobs = BlockInputBlobs.createFromRootHex(this.rootHex, this.config, this.metrics);
    if (this.block) {
      blockInputBlobs.addBlock(this.block);
    }
    return blockInputBlobs;
  }

  upgradeToColumns(): BlockInputColumns {
    const blockInputColumns = BlockInputColumns.createFromRootHex(this.rootHex, this.config, this.metrics);
    if (this.block) {
      blockInputColumns.addBlock(this.block);
    }
    return blockInputColumns;
  }
}

type BlockInputBlobsLogMeta = {
  blobsReceived: number;
  blobsExpected: number;
};

export type BlobMeta = {
  index: number;
  blockRoot: Uint8Array;
  versionHash: VersionHash;
};

export class BlockInputBlobs extends BlockInput<deneb.BlobSidecars> {
  type: BlockInputType.Blobs;
  protected block?: SignedBeaconBlock<ForkBlobs>;
  protected blobsCache: Map<number, CachedBlob>;

  static createFromBlobSidecar({
    config,
    metrics,
    abortSignal,
    blockRoot,
    blobSidecar,
    source,
    peerIdStr,
  }: BlockInputCoreProps & BlockInputBlobsProps): BlockInput {
    const forkName = config.getForkName(blobSidecar.signedBlockHeader.message.slot);
    const blockRoot = config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    return BlockInputBlobs({blockRoot, blobSidecar, forkName, metrics});
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

  getBlock(): SignedBeaconBlock<ForkBlobs> {
    return super.getBlock();
  }

  async waitForBlock(timeout: number): Promise<SignedBeaconBlock<ForkBlobs>> {
    return super.waitForBlock(timeout);
  }

  addBlob(blobSidecar: deneb.BlobSidecar, source: BlockInputSourceType, peerIdStr?: string): void {
    const blockRoot = this.config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
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
    if (this.block) {
      const numberOfBlobs = this.blobsCache.size();
      const numberOfCommitments = this.block.message.body.blobKzgCommitments.length;
      if (numberOfBlobs > numberOfCommitments) {
        // Should loop though commitments to figure out which index doesn't match block commitments?
        throw new BlockInputError({
          code: BlockInputErrorCode.TOO_MANY_RECEIVED_BLOBS,
          numberOfCommitments,
          numberOfBlobs,
          slot: this.block.message.slot,
          blockRoot,
        });
      }
      // TODO: should this get checked that the commitment is contained in the block?
      if (numberOfBlobs === numberOfCommitments) {
        this.dataPromise.resolve([...this.blobsCache.values()]);
      }
    }
  }

  getNeededBlobMeta(): undefined | BlobMeta[] {
    if (!this.block) {
      return undefined;
    }

    const commitments = this.block.message.body.blobKzgCommitments;

    const blobsMeta: BlobMeta[] = [];
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

  getLogMeta(): BlockInput["getLogMeta"] & BlockInputBlobsLogMeta {
    return {
      ...super.getLogMeta(),
      blobsExpected: `${this.block?.message.body.blobKzgCommitments.length}`,
      blobsReceived: this.blobsCache.size(),
    };
  }

  protected constructor({
    config,
    metrics,
    abortSignal,
    blockRoot,
    blobSidecar,
    source,
    peerIdStr,
  }: BlockInputCoreProps & BlockInputBlobsProps) {
    super({config, metrics, abortSignal, blockRoot});
    this.blobsCache.set(blobSidecar.index, {blobSidecar, source, peerIdStr});
  }
}

export class BlockInputColumns extends BlockInput {
  type: BlockInputType.Columns;
  protected block: SignedBeaconBlock<ForkPostFulu>;
  protected columnsCache: Map<number, CachedColumn>;

  static createFromColumnSidecar(config: ChainForkConfig, columnSidecar: fulu.DataColumnSidecar): BlockInput {
    const forkName = config.getForkName(columnSidecar.signedBlockHeader.message.slot);
    const blockRoot = config
      .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
    return BlockInputColumns({blockRoot, columnSidecar, forkName});
  }

  addColumnSidecar(columnSidecar: fulu.DataColumnSidecar, source: BlockInputSource, peerIdStr?: string): void {
    const blockRoot = this.config
      .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
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
    if (this.block && this.block.message.body.blobKzgCommitments.length === this.columnsCache.size()) {
      this.dataPromise.resolve([...this.columnsCache.values()]);
    }
  }

  getNeededColumnIndices(): number[] {}

  protected constructor({
    blockRoot,
    columnSidecar,
    forkName,
  }: {blockRoot: RootHex; columnSidecar: deneb.BlobSidecar; forkName: ForkName}) {
    super(blockRoot, undefined, forkName);
    this.columnsCache.set(columnSidecar.index, columnSidecar);
  }
}

enum BlockInputErrorCode {
  MISMATCHED_BLOCK_ROOT = "BLOCK_INPUT_ERROR_MISMATCHED_BLOCK_ROOT",
  AWAIT_DATA_PRE_DENEB = "BLOCK_INPUT_ERROR_CANNOT_AWAIT_DATA_PRE_DENEB",
  ALREADY_SEEN_BLOB = "BLOCK_INPUT_ERROR_ALREADY_SEEN_BLOB",
  TOO_MANY_RECEIVED_BLOBS = "BLOCK_INPUT_ERROR_TOO_MANY_RECEIVED_BLOBS",
  ALREADY_SEEN_COLUMN = "BLOCK_INPUT_ERROR_ALREADY_SEEN_COLUMN",
  NO_BLOCK_TO_GET = "BLOCK_INPUT_NO_BLOCK_TO_GET",
}

type BlockInputErrorType =
  | {
      code: BlockInputErrorCode.AWAIT_DATA_PRE_DENEB;
    }
  | {
      code: BlockInputErrorCode.NO_BLOCK_TO_GET;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT;
      blockInputRoot: RootHex;
      mismatchedRoot: RootHex;
      source?: BlockInputSource;
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
    };

class BlockInputError extends LodestarError<BlockInputErrorType> {}
