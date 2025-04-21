import {ChainForkConfig} from "@lodestar/config";
import {RootHex, Slot} from "@lodestar/types";
import {LodestarError, Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {BlockInput, BlockInputType, isBlockInputBlobs} from "../blocks/blockInput/index.js";

export type BlockInputCacheModules = {
  config: ChainForkConfig;
  //   custodyConfig: CustodyConfig;
  metrics: Metrics | null;
  logger?: Logger;
};

export class BlockInputCache {
  private config: ChainForkConfig;
  private metrics: Metrics | null;
  private logger?: Logger;
  private blockInputs = new Map<RootHex, BlockInput>();

  constructor({config, metrics, logger}: BlockInputCacheModules) {
    this.config = config;
    this.metrics = metrics;
    this.logger = logger;
  }

  hasBlock(rootHex: RootHex): boolean {
    return this.blockInputs.has(rootHex);
  }

  /**
   * Removes block from BlockInput if it does not pass validation after gossip or reqresp checks.  If the blockInput does
   * not yet have any data associated for that rootHex then the blockInput will be pruned from the cache.
   */
  removeBlockFromBlockInput(rootHex: RootHex): void {
    const blockInput = this.blockInputs.get(rootHex);
    if (!blockInput) {
      return;
    }
    blockInput.removeBlock();
    if (!blockInput.hasData()) {
      this.blockInputs.delete(blockInput.rootHex);
    }
  }

  /**
   * Removes blob from BlockInput if it does not pass validation after gossip or reqresp checks.  If the blockInput does
   * not yet have a block or any data associated for that rootHex then the blockInput will be pruned from the cache.
   */
  removeBlobsFromBlockInput(rootHex: RootHex, blobIndices: number[]): void {
    const blockInput = this.blockInputs.get(rootHex);
    if (!blockInput) {
      return;
    }
    if (!isBlockInputBlobs(blockInput)) {
      throw new BlockInputCacheError({
        code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
        cachedType: blockInput.type,
        requestedType: BlockInputType.Blobs,
      });
    }
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
  // removeColumnsFromBlockInput(rootHex: RootHex, columnIndices: number[]): void {
  //   const blockInput = this.blockInputs.get(rootHex);
  //   if (!blockInput) {
  //     return;
  //   }
  //   if (!isBlockInputColumns(blockInput)) {
  //     throw new BlockInputCacheError({
  //       code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
  //       cachedType: blockInput.type,
  //       requestedType: BlockInputType.Columns,
  //     });
  //   }
  //   for (const index of columnIndices) {
  //     blockInput.removeColumn(index);
  //   }
  //   if (!(blockInput.hasData() && blockInput.hasBlock())) {
  //     this.blockInputs.delete(blockInput.rootHex);
  //   }
  // }
}

enum BlockInputCacheErrorCode {
  WRONG_BLOCK_INPUT_TYPE = "BLOCK_INPUT_CACHE_ERROR_WRONG_BLOCK_INPUT_TYPE",
  SLOT_MISMATCH = "BLOCK_INPUT_CACHE_ERROR_SLOT_MISMATCH",
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
