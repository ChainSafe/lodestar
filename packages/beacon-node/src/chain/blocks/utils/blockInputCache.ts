import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkBlobs, isForkPostFulu} from "@lodestar/params";
import {deneb, fulu, RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {LodestarError, Logger, toHex} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputPreDeneb,
  BlockInputSource,
  BlockInputSourceType,
  BlockInputType,
} from "./blockInput.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {Metrics} from "../../../metrics/metrics.js";

export class BlockInputCache {
  private blockInputs = new Map<RootHex, BlockInput<unknown>>();

  constructor(
    private config: ChainForkConfig,
    private custodyConfig: CustodyConfig,
    private logger?: Logger,
    private metrics?: Metrics
  ) {}

  getBlockInputByRootHex({rootHex, slot}: {rootHex: string; slot?: Slot}): BlockInput {
    let blockInput = this.blockInputs.get(rootHex);
    if (!blockInput) {
      if (slot) {
        const forkName = this.config.getForkName(slot);
        if (isForkBlobs(forkName)) {
          blockInput = BlockInputBlobs.createFromRootHex({rootHex, slot, forkName});
        } else if (isForkPostFulu(forkName)) {
          blockInput = BlockInputColumns.createFromRootHex({rootHex, slot, forkName});
        } else {
          blockInput = BlockInputPreDeneb.createFromRootHex({rootHex, slot, forkName});
        }
      } else {
        blockInput = BlockInputPreDeneb.createFromRootHex({rootHex});
      }
      this.blockInputs.set(rootHex, blockInput);
    } else if (slot) {
      const blockSlot = blockInput.getSlot(false);
      if (!blockSlot) {
        blockInput.setSlot(slot);
      } else if (blockSlot !== slot) {
        throw new BlockInputCacheError({
          code: BlockInputCacheErrorCode.SLOT_MISMATCH,
          blockInputSlot: blockInput.slot,
          slot,
        });
      }
    }
    return blockInput;
  }

  getBlockInputByBlock(block: SignedBeaconBlock, source: BlockInputSourceType, peerIdStr?: string): BlockInput {
    const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const rootHex = toHex(blockRoot);
    const forkName = this.config.getForkName(block.message.slot);

    let blockInput = this.blockInputs.get(rootHex);
    if (blockInput) {
      if (!blockInput.hasBlock()) {
        blockInput.addBlock({rootHex, blockRoot, block, forkName, source, peerIdStr});
      } else {
        // TODO: add a metric here
      }
      return blockInput;
    }

    if (isForkBlobs(forkName)) {
      blockInput = BlockInputBlobs.createFromBlock(this.config, block);
    } else if (isForkPostFulu(forkName)) {
      blockInput = BlockInputColumns.createFromBlock(this.config, block);
    } else {
      blockInput = BlockInputPreDeneb.createFromBlock({block, blockRoot, rootHex, forkName, source, peerIdStr});
    }

    this.blockInputs.set(blockRoot, blockInput);
    return blockInput;
  }

  getBlockInputByBlob(blobSidecar: deneb.BlobSidecar, source: BlockInputSource, peerIdStr?: string): BlockInputBlobs {
    const blockRoot = this.config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    const blockHex = toHex(blockRoot);
    let blockInput = this.blockInputs.get(blockHex) as BlockInputBlobs;
    if (blockInput) {
      if (blockInput.type !== BlockInputType.Blobs) {
        throw new BlockInputCacheError(
          {
            code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
            cachedType: blockInput.type,
            requestedType: BlockInputType.Blobs,
          },
          `BlockInputType mismatch for slot=${blobSidecar.signedBlockHeader.message.slot} blockRoot=${blockHex}`
        );
      }
      blockInput.addBlob(this.config, blobSidecar);
    } else {
      blockInput = BlockInputBlobs.createFromBlobSidecar({
        config,
        metrics,
        abortSignal,
        blockRoot,
        blobSidecar,
        source,
        peerIdStr,
      });
      this.blockInputs.set(blockHex, blockInput);
    }

    return blockInput;
  }

  getBlockInputByColumn(
    columnSidecar: fulu.DataColumnSidecar,
    source: BlockInputSource,
    peerIdStr?: string
  ): BlockInputColumns {
    const blockRoot = toHex(
      this.config
        .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
        .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message)
    );

    let blockInput = this.blockInputs.get(blockRoot) as BlockInputColumns;
    if (blockInput) {
      if (blockInput.type !== BlockInputType.Blobs) {
        throw new BlockInputCacheError(
          {
            code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
            cachedType: blockInput.type,
            requestedType: BlockInputType.Columns,
          },
          `BlockInputType mismatch for slot=${columnSidecar.signedBlockHeader.message.slot} blockRoot=${blockRoot}`
        );
      }
      blockInput.addColumnSidecar(this.config, columnSidecar);
    } else {
      blockInput = BlockInputColumns.createFromColumnSidecar(this.config, columnSidecar);
      this.blockInputs.set(blockRoot, blockInput);
    }

    return blockInput;
  }

  /**
   * Removes block from BlockInput if it does not pass validation after gossip or reqresp checks.  If the blockInput does
   * not yet have any data associated for that rootHex then the blockInput will be pruned from the cache.
   */
  removeBlockFromBlockInput(blockInput: BlockInput): void {
    blockInput.removeBlock();
    if (!blockInput.hasData()) {
      this.blockInputs.delete(blockInput.rootHex);
    }
  }

  /**
   * Removes blob from BlockInput if it does not pass validation after gossip or reqresp checks.  If the blockInput does
   * not yet have a block or any data associated for that rootHex then the blockInput will be pruned from the cache.
   */
  removeBlobsFromBlockInput(blockInput: BlockInput, blobIndices: number[]): void {
    for (const index of blobIndices) {
      blockInput.removeBlob(index);
    }
    if (!(blockInput.hasData() && blockInput.hasBlock())) {
      this.blockInputs.delete(blockInput.rootHex);
    }
  }

  /**
   * Removes blob from BlockInput if it does not pass validation after gossip or reqresp checks.  If the blockInput does
   * not yet have a block or any data associated for that rootHex then the blockInput will be pruned from the cache.
   */
  removeColumnsFromBlockInput(blockInput: BlockInput, columnIndices: number[]): void {
    for (const index of columnIndices) {
      blockInput.removeColumn(index);
    }
    if (!(blockInput.hasData() && blockInput.hasBlock())) {
      this.blockInputs.delete(blockInput.rootHex);
    }
  }

  /**
   * Removes blockInput and all ancestor BlockInputs from cache.  Best to use this only when removing
   * successfully processed blocks. If just a bad block or data object is received use `removeInvalidBlock`,
   * `removeInvalidBlob` or `removeInvalidColumn` instead.
   */
  prune(blockInput: BlockInput): void {
    let nextBlockInput: BlockInput | undefined = blockInput;
    while (nextBlockInput) {
      const parentRootHex = nextBlockInput.getParentRootHex();
      this.blockInputs.delete(nextBlockInput.rootHex);
      nextBlockInput = this.blockInputs.get(parentRootHex);
    }
  }
}

enum BlockInputCacheErrorCode {
  WRONG_BLOCK_INPUT_TYPE = "BLOCK_PROCESS_INPUT_CACHE_ERROR_WRONG_BLOCK_INPUT_TYPE",
  SLOT_MISMATCH = "BLOCK_PROCESS_INPUT_CACHE_ERROR_SLOT_MISMATCH",
}

type BlockInputCacheErrorType =
  | {
      code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE;
      cachedType: BlockInputType;
      requestedType: BlockInputType;
    }
  | {
      code: BlockInputCacheErrorCode.SLOT_MISMATCH;
      blockInputSlot: Slot;
      slot: Slot | string;
    };

class BlockInputCacheError extends LodestarError<BlockInputCacheErrorType> {}
