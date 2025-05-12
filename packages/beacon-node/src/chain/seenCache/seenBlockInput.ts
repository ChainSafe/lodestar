import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostDeneb, isForkPostDeneb} from "@lodestar/params";
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
  LogMetaBasic,
  getDataAvailabilityStatus,
  isBlockInputBlobs,
} from "../blocks/blockInput-mkeil/index.js";
import {BlobSidecarErrorCode, BlobSidecarGossipError} from "../errors/blobSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";

export type SeenBlockInputCacheModules = {
  config: ChainForkConfig;
  clock: IClock;
  //   custodyConfig: CustodyConfig;
  metrics: Metrics | null;
  logger?: Logger;
};

export type GetByBlobOptions = {
  throwGossipErrorIfAlreadyKnown?: boolean;
};

/**
 * Consumers that create BlockInputs or change types of old BlockInputs
 *
 * - gossipHandlers (block and blob)
 * - beaconBlocksMaybeBlobsByRange
 * - unavailableBeaconBlobsByRoot (beaconBlocksMaybeBlobsByRoot)
 * - publishBlock in the beacon/blocks/index.ts API
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

    if (metrics) {
      metrics.seenCache.blockInput.blockInputCount.addCollect(() =>
        metrics.seenCache.blockInput.blockInputCount.set(this.blockInputs.size)
      );
    }
  }

  hasBlock(rootHex: RootHex): boolean {
    return this.blockInputs.has(rootHex);
  }

  getBlockInputByBlock({
    block,
    seenTimestampSec,
    source,
    peerIdStr,
  }: {blockRoot: Uint8Array} & Omit<
    AddBlockProps<SignedBeaconBlock>,
    "rootHex" | "forkName" | "dataAvailability"
  >): BlockInput {
    const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const {rootHex, forkName} = this.buildCommonProps(blockRoot, block.message.slot);

    let blockInput = this.blockInputs.get(rootHex);
    if (!blockInput) {
      if (!isForkPostDeneb(forkName)) {
        blockInput = new BlockInputPreData({
          config: this.config,
          clock: this.clock,
          block,
          blockRoot,
          rootHex,
          seenTimestampSec,
          source,
          peerIdStr,
        });
      }
      // else if (isForkPostFulu(forkName)) {
      //   blockInput = new BlockInputColumns({})
      // }
      else {
        blockInput = new BlockInputBlobs({
          config: this.config,
          clock: this.clock,
          block: block as SignedBeaconBlock<ForkPostDeneb>,
          blockRoot,
          rootHex,
          seenTimestampSec,
          source,
          peerIdStr,
        });
      }
    }

    if (!blockInput.hasBlock()) {
      blockInput.addBlock({block, seenTimestampSec, source, peerIdStr});
    } else {
      this.logger?.debug("Attempt to cache block but is already cached on BlockInput", blockInput.getLogMeta());
      this.metrics?.seenCache.blockInput.duplicateBlockCount.inc();
    }

    return blockInput;
  }

  getBlockInputByBlob(
    {blobSidecar, seenTimestampSec, source, peerIdStr}: Omit<AddBlobProps, "rootHex"> & {blockRoot: Uint8Array},
    opts: GetByBlobOptions = {}
  ): BlockInput {
    const blockRoot = this.config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    const {rootHex} = this.buildCommonProps(blockRoot, blobSidecar.signedBlockHeader.message.slot);

    let blockInput = this.blockInputs.get(rootHex);
    if (!blockInput) {
      // TODO(@matthewkeil): Need to update this to refactored BlockInput
      blockInput = new BlockInputBlobs({
        config: this.config,
        clock: this.clock,
        blobSidecar,
        blockRoot,
        rootHex,
        seenTimestampSec,
        source,
        peerIdStr,
      });
      this.metrics?.seenCache.blockInput.createdByBlob.inc();
      this.blockInputs.set(rootHex, blockInput);
    }

    if (!isBlockInputBlobs(blockInput)) {
      throw new SeenBlockInputCacheError(
        {
          code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
          cachedType: blockInput.type,
          requestedType: BlockInputType.Blobs,
          ...blockInput.getLogMeta(),
        },
        `BlockInputType mismatch adding blobIndex=${blobSidecar.index}`
      );
    }

    if (!blockInput.hasBlob(blobSidecar.index)) {
      blockInput.addBlob({blobSidecar, rootHex, seenTimestampSec, source, peerIdStr});
    } else {
      this.logger?.debug(
        `Attempt to cache blob index #${blobSidecar.index} but is already cached on BlockInput`,
        blockInput.getLogMeta()
      );
      this.metrics?.seenCache.blockInput.duplicateBlobCount.inc();
      if (opts.throwGossipErrorIfAlreadyKnown) {
        throw new BlobSidecarGossipError(GossipAction.IGNORE, {
          code: BlobSidecarErrorCode.ALREADY_KNOWN,
          root: rootHex,
        });
      }
    }

    return blockInput;
  }

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
  | (LogMetaBasic & {
      code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE;
      cachedType: BlockInputType;
      requestedType: BlockInputType;
    })
  | {
      code: SeenBlockInputCacheErrorCode.SLOT_MISMATCH;
      blockInputSlot: Slot;
      slot: Slot | string;
    };

class SeenBlockInputCacheError extends LodestarError<SeenBlockInputCacheErrorType> {}
