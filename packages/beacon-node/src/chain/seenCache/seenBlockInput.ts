import {ChainForkConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {ForkName, isForkPostDeneb} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot, deneb} from "@lodestar/types";
import {LodestarError, Logger, pruneSetToMax, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {
  BlockInputBlobs,
  BlockInputPreData,
  DAType,
  ForkBlobsDA,
  IBlockInput,
  LogMetaBasic,
  SourceMeta,
  getDaOutOfRange,
  isBlockInputBlobs,
} from "../blocks/blockInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {BlobSidecarErrorCode, BlobSidecarGossipError} from "../errors/blobSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";

const MAX_BLOCK_INPUT_CACHE_SIZE = 5;

export type SeenBlockInputCacheModules = {
  config: ChainForkConfig;
  clock: IClock;
  chainEvents: ChainEventEmitter;
  signal: AbortSignal;
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
  private readonly config: ChainForkConfig;
  private readonly clock: IClock;
  private readonly chainEvents: ChainEventEmitter;
  private readonly signal: AbortSignal;
  private readonly metrics: Metrics | null;
  private readonly logger?: Logger;
  private blockInputs = new Map<RootHex, IBlockInput>();

  constructor({config, clock, chainEvents, signal, metrics, logger}: SeenBlockInputCacheModules) {
    this.config = config;
    this.clock = clock;
    this.chainEvents = chainEvents;
    this.signal = signal;
    this.metrics = metrics;
    this.logger = logger;

    if (metrics) {
      metrics.seenCache.blockInput.blockInputCount.addCollect(() =>
        metrics.seenCache.blockInput.blockInputCount.set(this.blockInputs.size)
      );
    }

    this.chainEvents.on(ChainEvent.forkChoiceFinalized, this.onFinalized);
    this.signal.addEventListener("abort", () => {
      this.chainEvents.off(ChainEvent.forkChoiceFinalized, this.onFinalized);
    });
  }

  has(rootHex: RootHex): boolean {
    return this.blockInputs.has(rootHex);
  }

  get(rootHex: RootHex): IBlockInput | undefined {
    return this.blockInputs.get(rootHex);
  }

  /**
   * Removes the single BlockInput from the cache
   */
  remove(rootHex: RootHex): void {
    this.blockInputs.delete(rootHex);
  }

  /**
   * Removes a processed BlockInput from the cache and also removes any ancestors of processed blocks
   */
  prune(rootHex: RootHex): void {
    let blockInput = this.blockInputs.get(rootHex);
    let parentRootHex = blockInput?.parentRootHex;
    while (blockInput) {
      this.blockInputs.delete(blockInput.blockRootHex);
      blockInput = this.blockInputs.get(parentRootHex ?? "");
      parentRootHex = blockInput?.parentRootHex;
    }
    this.pruneToMaxSize();
  }

  onFinalized = (checkpoint: CheckpointWithHex) => {
    const cutoffSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    for (const [rootHex, blockInput] of this.blockInputs) {
      if (blockInput.slot < cutoffSlot) {
        this.blockInputs.delete(rootHex);
      }
    }
    this.pruneToMaxSize();
  };

  getByBlock({block, source, seenTimestampSec, peerIdStr}: SourceMeta & {block: SignedBeaconBlock}): IBlockInput {
    const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);

    // TODO(peerDAS): Why is it necessary to static cast this here. All conditional paths result in a valid value so should be defined correctly below
    let blockInput = this.blockInputs.get(blockRootHex) as IBlockInput;
    if (!blockInput) {
      const {forkName, daOutOfRange} = this.buildCommonProps(block.message.slot);
      if (!isForkPostDeneb(forkName)) {
        blockInput = BlockInputPreData.createFromBlock({
          block,
          blockRootHex,
          daOutOfRange,
          forkName,
          source: {
            source,
            seenTimestampSec,
            peerIdStr,
          },
        });
      }
      // else if (isForkPostFulu(forkName)) {
      //   blockInput = new BlockInputColumns.createFromBlock({
      //     block,
      //     blockRootHex,
      //     daOutOfRange,
      //     forkName,
      //     custodyColumns: this.custodyConfig.custodyColumns,
      //     sampledColumns: this.custodyConfig.sampledColumns,
      //     source: {
      //       source,
      //       seenTimestampSec,
      //       peerIdStr
      //     }
      //   })
      // }
      else {
        blockInput = BlockInputBlobs.createFromBlock({
          block: block as SignedBeaconBlock<ForkBlobsDA>,
          blockRootHex,
          daOutOfRange,
          forkName,
          source: {
            source,
            seenTimestampSec,
            peerIdStr,
          },
        });
      }
      this.blockInputs.set(blockInput.blockRootHex, blockInput);
    }

    if (!blockInput.hasBlock()) {
      blockInput.addBlock({block, blockRootHex, source: {source, seenTimestampSec, peerIdStr}});
    } else {
      this.logger?.debug("Attempt to cache block but is already cached on BlockInput", blockInput.getLogMeta());
      this.metrics?.seenCache.blockInput.duplicateBlockCount.inc();
    }

    return blockInput;
  }

  getByBlob(
    {blobSidecar, source, seenTimestampSec, peerIdStr}: SourceMeta & {blobSidecar: deneb.BlobSidecar},
    opts: GetByBlobOptions = {}
  ): BlockInputBlobs {
    const blockRoot = this.config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    const blockRootHex = toRootHex(blockRoot);

    // TODO(peerDAS): Why is it necessary to static cast this here. All conditional paths result in a valid value so should be defined correctly below
    let blockInput = this.blockInputs.get(blockRootHex) as IBlockInput;
    let created = false;
    if (!blockInput) {
      created = true;
      const {forkName, daOutOfRange} = this.buildCommonProps(blobSidecar.signedBlockHeader.message.slot);
      blockInput = BlockInputBlobs.createFromBlob({
        blobSidecar,
        blockRootHex,
        daOutOfRange,
        forkName,
        source,
        seenTimestampSec,
        peerIdStr,
      });
      this.metrics?.seenCache.blockInput.createdByBlob.inc();
      this.blockInputs.set(blockRootHex, blockInput);
    }

    if (!isBlockInputBlobs(blockInput)) {
      throw new SeenBlockInputCacheError(
        {
          code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
          cachedType: blockInput.type,
          requestedType: DAType.Blobs,
          ...blockInput.getLogMeta(),
        },
        `BlockInputType mismatch adding blobIndex=${blobSidecar.index}`
      );
    }

    if (!blockInput.hasBlob(blobSidecar.index)) {
      blockInput.addBlob({blobSidecar, blockRootHex, source, seenTimestampSec, peerIdStr});
    } else if (!created) {
      this.logger?.debug(
        `Attempt to cache blob index #${blobSidecar.index} but is already cached on BlockInput`,
        blockInput.getLogMeta()
      );
      this.metrics?.seenCache.blockInput.duplicateBlobCount.inc();
      if (opts.throwGossipErrorIfAlreadyKnown) {
        throw new BlobSidecarGossipError(GossipAction.IGNORE, {
          code: BlobSidecarErrorCode.ALREADY_KNOWN,
          root: blockRootHex,
        });
      }
    }

    return blockInput;
  }

  private buildCommonProps(slot: Slot): {
    daOutOfRange: boolean;
    forkName: ForkName;
  } {
    const forkName = this.config.getForkName(slot);
    return {
      forkName,
      daOutOfRange: getDaOutOfRange(this.config, forkName, slot, this.clock.currentEpoch),
    };
  }

  /**
   * Use custom implementation of pruneSetToMax to allow for sorting by slot
   * and deleting via key/rootHex
   */
  private pruneToMaxSize() {
    let itemsToDelete = this.blockInputs.size - MAX_BLOCK_INPUT_CACHE_SIZE;

    if (itemsToDelete > 0) {
      const sorted = [...this.blockInputs.entries()].sort((a, b) => b[1].slot - a[1].slot);
      for (const rootHex of sorted) {
        this.blockInputs.delete(rootHex);
        itemsToDelete--;
        if (itemsToDelete <= 0) return;
      }
    }
  }
}

enum SeenBlockInputCacheErrorCode {
  WRONG_BLOCK_INPUT_TYPE = "BLOCK_INPUT_CACHE_ERROR_WRONG_BLOCK_INPUT_TYPE",
}

type SeenBlockInputCacheErrorType = LogMetaBasic & {
  code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE;
  cachedType: DAType;
  requestedType: DAType;
};

class SeenBlockInputCacheError extends LodestarError<SeenBlockInputCacheErrorType> {}
