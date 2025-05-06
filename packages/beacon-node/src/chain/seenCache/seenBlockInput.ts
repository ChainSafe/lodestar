import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {LodestarError, Logger, toHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {
  AddBlobProps,
  AddBlockProps,
  BlockInput,
  BlockInputBlobs,
  BlockInputPreData,
  BlockInputType,
  DataAvailabilityStatus,
  getDataAvailabilityStatus,
  isBlockInputBlobs,
} from "../blocks/blockInput/index.js";

export type SeenBlockInputCacheModules = {
  config: ChainForkConfig;
  clock: IClock;
  //   custodyConfig: CustodyConfig;
  metrics: Metrics | null;
  logger?: Logger;
};

/**
 * Consumers that create BlockInputs or change types of old BlockInputs
 *
 * - gossipHandlers (block and blob)
 * - beaconBlocksMaybeBlobsByRange
 * - unavailableBeaconBlobsByRoot (beaconBlocksMaybeBlobsByRoot)
 * - publishBlock in the API
 *   https://github.com/ChainSafe/lodestar/blob/unstable/packages/beacon-node/src/api/impl/beacon/blocks/index.ts#L62
 * - maybeValidateBlobs in verifyBlocksDataAvailability (is_data_available spec function)
 *   https://github.com/ChainSafe/lodestar/blob/unstable/packages/beacon-node/src/chain/blocks/verifyBlocksDataAvailability.ts#L111
 */

export class SeenBlockInputCache {
  private config: ChainForkConfig;
  private clock: IClock;
  private metrics: Metrics | null;
  private logger?: Logger;
  private blockInputs = new Map<RootHex, BlockInput>();

  constructor({config, clock, metrics, logger}: SeenBlockInputCacheModules) {
    this.config = config;
    this.clock = clock;
    this.metrics = metrics;
    this.logger = logger;
  }

  hasBlock(rootHex: RootHex): boolean {
    return this.blockInputs.has(rootHex);
  }

  getBlockInputByBlock({
    block,
    blockRoot,
    seenTimestampSec,
    source,
    peerIdStr,
  }: {blockRoot: Uint8Array} & Omit<
    AddBlockProps<SignedBeaconBlock>,
    "rootHex" | "forkName" | "dataAvailability"
  >): BlockInput {
    const {rootHex, forkName, dataAvailability} = this.buildCommonProps(blockRoot, block.message.slot);

    let blockInput = this.blockInputs.get(rootHex);
    if (blockInput) {
      if (!blockInput.hasBlock()) {
        blockInput.addBlock({block, seenTimestampSec, source, peerIdStr});
      } else {
        // TODO: add a metric here
      }
      return blockInput;
    }

    if (!isForkPostDeneb()) {
      blockInput = new BlockInputPreData({
        block,
        blockRoot,
        dataAvailability,
        forkName,
        rootHex,
        seenTimestampSec,
        source,
        peerIdStr,
      });
    }
  }

  getBlockInputByBlob({
    blobSidecar,
    blockRoot,
    seenTimestampSec,
    source,
    peerIdStr,
  }: Omit<AddBlobProps, "rootHex"> & {blockRoot: Uint8Array}): BlockInput {
    const {rootHex, forkName, dataAvailability} = this.buildCommonProps(
      blockRoot,
      blobSidecar.signedBlockHeader.message.slot
    );

    let blockInput = this.blockInputs.get(rootHex);
    if (!blockInput) {
      blockInput = new BlockInputBlobs({
        blobSidecar,
        blockRoot,
        rootHex,
        dataAvailability,
        forkName,
        seenTimestampSec,
        source,
        peerIdStr,
      });
      this.blockInputs.set(rootHex, blockInput);
      return blockInput;
    }

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

    if (!blockInput.hasBlob(blobSidecar.index)) {
      blockInput.addBlob({blobSidecar, rootHex, seenTimestampSec, source, peerIdStr});
    }
    // else {
    // TODO: not sure if this should throw here or maybe collect a metric. Saw a note about
    //       handling this case but this is newly added
    //
    // TODO: add metrics here for duplicate blob
    // }

    return blockInput;
  }

  getBlockInputByColumn(): BlockInput {}

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
      throw new SeenBlockInputCacheError({
        code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
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
  //     throw new SeenBlockInputCacheError({
  //       code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
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

  private buildCommonProps(
    blockRoot: Uint8Array,
    slot: Slot
  ): {
    dataAvailability: DataAvailabilityStatus;
    forkName: ForkName;
    rootHex: string;
  } {
    return {
      rootHex: toHex(blockRoot),
      forkName: this.config.getForkName(slot),
      dataAvailability: getDataAvailabilityStatus(this.config, slot, this.clock.currentEpoch),
    };
  }
}

enum SeenBlockInputCacheErrorCode {
  WRONG_BLOCK_INPUT_TYPE = "BLOCK_INPUT_CACHE_ERROR_WRONG_BLOCK_INPUT_TYPE",
  SLOT_MISMATCH = "BLOCK_INPUT_CACHE_ERROR_SLOT_MISMATCH",
}

type SeenBlockInputCacheErrorType =
  | {
      code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE;
      cachedType: BlockInputType;
      requestedType: BlockInputType;
    }
  | {
      code: SeenBlockInputCacheErrorCode.SLOT_MISMATCH;
      blockInputSlot: Slot;
      slot: Slot | string;
    };

class SeenBlockInputCacheError extends LodestarError<SeenBlockInputCacheErrorType> {}
