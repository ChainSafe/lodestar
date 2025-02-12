import {ChainForkConfig} from "@lodestar/config";
import {ForkBlobs, ForkName, ForkPostFulu} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {LodestarError, withTimeout} from "@lodestar/utils";

/**
 * Represents were input originated. Blocks and Data can come from different
 * sources so each should be labelled individually.
 */
// export enum InputSource {
//   gossip = "gossip",
//   api = "api",
//   byRange = "req_resp_by_range",
//   byRoot = "req_resp_by_root",
// }

type PromiseParts<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
};

export abstract class BlockInput<T> {
  blockRoot: RootHex;
  protected block?: SignedBeaconBlock;
  protected forkName?: ForkName;
  protected blockPromise = this.createPromise<SignedBeaconBlock>();
  protected dataPromise = this.createPromise<T>();

  // TODO: do we really need this?
  protected abortSignal: AbortSignal;

  static createFromBlock(config: ChainForkConfig, block: SignedBeaconBlock): BlockInput {
    const forkName = config.getForkName(block.message.slot);
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    return new BlockInput({blockRoot, block, forkName});
  }

  static createFromBlockRoot(blockRoot: RootHex): BlockInput {
    return new BlockInput({blockRoot});
  }

  addBlock(config: ChainForkConfig, block: SignedBeaconBlock): void {
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

  async waitForBlock(timeout: number): Promise<BlockInput> {
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

  protected constructor({
    blockRoot,
    block,
    forkName,
    abortSignal,
  }: {blockRoot: RootHex; block?: SignedBeaconBlock; forkName?: ForkName; abortSignal?: AbortSignal}) {
    this.blockRoot = blockRoot;
    this.block = block;
    this.forkName = forkName;
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
  waitForData(): Promise<void> {
    throw new BlockInputError({code: BlockInputErrorCode.AWAIT_DATA_PRE_DENEB});
  }

  async waitForBlockAndData(): Promise<BlockInput> {
    await this.waitForBlock();
    return this;
  }
}

// export type CachedBlob = {
//   blob: deneb.BlobSidecar;
//   source: InputSource;
// };
export class BlockInputBlobs extends BlockInput<deneb.BlobSidecars> {
  protected block: SignedBeaconBlock<ForkBlobs>;
  protected blobsCache: Map<number, deneb.BlobSidecar>;

  static createFromBlobSidecar(config: ChainForkConfig, blobSidecar: deneb.BlobSidecar): BlockInput {
    const forkName = config.getForkName(blobSidecar.signedBlockHeader.message.slot);
    const blockRoot = config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    return BlockInputBlobs({blockRoot, blobSidecar, forkName});
  }

  addBlob(config: ChainForkConfig, blobSidecar: deneb.BlobSidecar): void {
    const blockRoot = config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    if (blockRoot !== this.blockRoot) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.blockRoot,
          mismatchedRoot: blockRoot,
        },
        "Invalid attempted to addBlob"
      );
    }
    // TODO: not sure if this should throw here.  Saw and note about handling this case but this is newly added
    // if (this.blobsCache.get(blobSidecar.index)) {
    //   throw new BlockInputError({code: BlockInputErrorCode.ALREADY_SEEN_BLOB, index: blobSidecar.index});
    // }
    this.blobsCache.set(blobSidecar.index, blobSidecar);
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
      if (numberOfBlobs === numberOfCommitments) {
        this.dataPromise.resolve([...this.blobsCache.values()]);
      }
    }
  }

  protected constructor({
    blockRoot,
    blobSidecar,
    forkName,
  }: {blockRoot: RootHex; blobSidecar: deneb.BlobSidecar; forkName: ForkName}) {
    super(blockRoot, undefined, forkName);
    this.blobsCache.set(blobSidecar.index, blobSidecar);
  }
}

// export type CachedColumn = {
//   column: fulu.DataColumnSidecar;
//   source: InputSource;
// };
export class BlockInputColumns extends BlockInput {
  protected block: SignedBeaconBlock<ForkPostFulu>;
  protected columnsCache: Map<number, fulu.DataColumnSidecar>;

  static createFromColumnSidecar(config: ChainForkConfig, columnSidecar: fulu.DataColumnSidecar): BlockInput {
    const forkName = config.getForkName(columnSidecar.signedBlockHeader.message.slot);
    const blockRoot = config
      .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
    return BlockInputColumns({blockRoot, columnSidecar, forkName});
  }

  addColumnSidecar(config: ChainForkConfig, columnSidecar: fulu.DataColumnSidecar): void {
    const blockRoot = config
      .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
    if (blockRoot !== this.blockRoot) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT,
          blockInputRoot: this.blockRoot,
          mismatchedRoot: blockRoot,
        },
        "Invalid attempted to addColumn"
      );
    }
    // TODO: not sure if this should throw here.  Saw and note about handling this case but this is newly added
    // if (this.columnsCache.get(columnSidecar.index)) {
    //   throw new BlockInputError({code: BlockInputErrorCode.ALREADY_SEEN_COLUMN, index: columnSidecar.index});
    // }
    this.columnsCache.set(columnSidecar.index, columnSidecar);
    if (this.block && this.block.message.body.blobKzgCommitments.length === this.columnsCache.size()) {
      this.dataPromise.resolve([...this.columnsCache.values()]);
    }
  }

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
}

type BlockInputErrorType =
  | {
      code: BlockInputErrorCode.AWAIT_DATA_PRE_DENEB;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_BLOCK_ROOT;
      blockInputRoot: RootHex;
      mismatchedRoot: RootHex;
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
