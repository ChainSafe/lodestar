import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb, isForkBlobs, isForkPostFulu} from "@lodestar/params";
import {deneb, Epoch, fulu, RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {LodestarError, Logger, toHex} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputPreDeneb,
  BlockInputSource,
  BlockInputSourceType,
  BlockInputType,
  isBlockInputBlobs,
  isBlockInputColumns,
} from "./blockInput.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {Metrics} from "../../../metrics/metrics.js";
import {BeaconChain} from "../../chain.js";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {DataAvailabilityStatus} from "@lodestar/fork-choice";

type BlockInputByRootHex = {
  rootHex: string;
  slot?: Slot;
  currentEpoch?: Epoch;
};
type BlockInputByBlock = {
  block: SignedBeaconBlock;
  source: BlockInputSourceType;
  peerIdStr?: string;
  dataAvailability?: DataAvailabilityStatus;
};
type BlockInputByBlob = {
  blobSidecar: deneb.BlobSidecar;
  source: BlockInputSource;
  peerIdStr?: string;
};
type BlockInputByColumn = {
  columnSidecar: fulu.DataColumnSidecar;
  source: BlockInputSource;
  peerIdStr?: string;
};
export class BlockInputCache {
  private blockInputs = new Map<RootHex, BlockInput>();

  constructor(
    private config: ChainForkConfig,
    private custodyConfig: CustodyConfig,
    private logger?: Logger,
    private metrics?: Metrics
  ) {}

  getBlockInputByRootHex({rootHex, slot}: BlockInputByRootHex): BlockInput {
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

  getBlockInputByBlock({block, source, peerIdStr, dataAvailability}: BlockInputByBlock): BlockInput {
    const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const rootHex = toHex(blockRoot);
    const forkName = this.config.getForkName(block.message.slot);
    // let dataAvailability: DataAvailabilityStatus | undefined;

    // if (currentEpoch !== undefined && isForkPostDeneb(forkName)) {
    //   const blockEpoch = computeEpochAtSlot(block.message.slot);
    //   if (blockEpoch >= currentEpoch - this.config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS) {
    //     dataAvailability = DataAvailabilityStatus.OutOfRange;
    //   }
    // }

    let blockInput = this.blockInputs.get(rootHex);
    if (blockInput) {
      if (!blockInput.hasBlock()) {
        blockInput.addBlock({rootHex, blockRoot, block, forkName, source, peerIdStr, dataAvailability});
      } else {
        // TODO: add a metric here
      }
      return blockInput;
    }

    if (isForkBlobs(forkName)) {
      blockInput = BlockInputBlobs.createFromBlock({
        block,
        blockRoot,
        rootHex,
        forkName,
        source,
        peerIdStr,
        dataAvailability,
        logger: this.logger,
        metrics: this.metrics,
      });
    } else if (isForkPostFulu(forkName)) {
      blockInput = BlockInputColumns.createFromBlock({
        block,
        blockRoot,
        rootHex,
        forkName,
        source,
        peerIdStr,
        dataAvailability,
        logger: this.logger,
        metrics: this.metrics,
      });
    } else {
      blockInput = BlockInputPreDeneb.createFromBlock({
        block,
        blockRoot,
        rootHex,
        forkName,
        source,
        peerIdStr,
        dataAvailability,
        logger: this.logger,
        metrics: this.metrics,
      });
    }

    this.blockInputs.set(blockRoot, blockInput);
    return blockInput;
  }

  getBlockInputByBlob({blobSidecar, source, peerIdStr}: BlockInputByBlob): BlockInputBlobs {
    const blockRoot = this.config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    const rootHex = toHex(blockRoot);

    let blockInput = this.blockInputs.get(rootHex) as BlockInputBlobs;
    if (blockInput) {
      if (!isBlockInputBlobs(blockInput)) {
        throw new BlockInputCacheError(
          {
            code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
            cachedType: blockInput.type,
            requestedType: BlockInputType.Blobs,
          },
          `BlockInputType mismatch for blobIndex=${blobSidecar.index} slot=${blobSidecar.signedBlockHeader.message.slot} blockRoot=${rootHex}`
        );
      }

      if (!blockInput.hasBlobSidecar(blobSidecar.index)) {
        blockInput.addBlobSidecar({rootHex, blobSidecar, source, peerIdStr});
      } else {
        // TODO: not sure if this should throw here or maybe collect a metric. Saw a note about
        //       handling this case but this is newly added
        //
        // TODO: add metrics here for duplicate blob
      }

      return blockInput;
    }

    blockInput = BlockInputBlobs.createFromBlobSidecar({
      blockRoot,
      rootHex,
      forkName: this.config.getForkName(blobSidecar.signedBlockHeader.message.slot),
      blobSidecar,
      source,
      peerIdStr,
      logger: this.logger,
      metrics: this.metrics,
    });
    this.blockInputs.set(rootHex, blockInput);

    return blockInput;
  }

  getBlockInputByColumn({columnSidecar, source, peerIdStr}: BlockInputByColumn): BlockInputColumns {
    const blockRoot = this.config
      .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
    const rootHex = toHex(blockRoot);

    let blockInput = this.blockInputs.get(blockRoot) as BlockInputColumns;
    if (blockInput) {
      if (!isBlockInputColumns(blockInput)) {
        throw new BlockInputCacheError(
          {
            code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
            cachedType: blockInput.type,
            requestedType: BlockInputType.Columns,
          },
          `BlockInputType mismatch for columnIndex=${columnSidecar.index} slot=${columnSidecar.signedBlockHeader.message.slot} blockRoot=${blockRoot}`
        );
      }
      if (!blockInput.hasColumn(columnSidecar.index)) {
        blockInput.addColumnSidecar({rootHex, columnSidecar, source, peerIdStr});
      } else {
        // TODO: not sure if this should throw here or maybe collect a metric. Saw a note about
        //       handling this case but this is newly added
        //
        // TODO: add metrics here for duplicate column
      }
      return blockInput;
    }

    blockInput = BlockInputColumns.createFromColumnSidecar({
      blockRoot,
      rootHex,
      forkName: this.config.getForkName(columnSidecar.signedBlockHeader.message.slot),,
      columnSidecar,
      source,
      peerIdStr,
      logger: this.logger,
      metrics: this.metrics,
    });
    this.blockInputs.set(rootHex, blockInput);

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
      blockInput.removeBlobSidecar(index);
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
