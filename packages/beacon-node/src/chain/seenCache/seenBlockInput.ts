import {ChainForkConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {ForkName, isForkPostDeneb} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot, deneb} from "@lodestar/types";
import {LodestarError, Logger, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {
  BlockInputBlobs,
  BlockInputPreData,
  DAType,
  ForkBlobsDA,
  IBlockInput,
  LogMetaBasic,
  LogMetaBlobs,
  SourceMeta,
  isBlockInputBlobs,
  isDaOutOfRange,
} from "../blocks/blockInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";

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
  throwErrorIfAlreadyKnown?: boolean;
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
 *
 *
 * Pruning management for SeenBlockInputCache
 * ------------------------------------------
 * There are four cases for how pruning needs to be handled
 * - Normal operation following head via gossip (and/or reqresp). For this situation the consumer (process pipeline or
 *   caller of processBlock) will call the `prune` method to remove any processed BlockInputs from the cache. This will
 *   also remove any ancestors of the processed BlockInput as that will also need to have been successfully processed
 *   for import to work correctly
 * - onFinalized event handler will help to prune any non-canonical forks once the chain finalizes. Any block-slots that
 *   are before the finalized checkpoint will be pruned.
 * - Range-sync periods.  The range process uses this cache to store and sync blocks with DA data as the chain is pulled
 *   from peers.  We pull batches, by epoch, so 32 slots are pulled at a time and several batches are pulled concurrently.
 *   It is important to set the MAX_BLOCK_INPUT_CACHE_SIZE high enough to support range sync activities.  Currently the
 *   value is set for 5 batches of 32 slots.  As process block is called (similar to following head) the BlockInput and
 *   its ancestors will be pruned.
 * - Non-Finality times.  This is a bit more tricky.  There can be long periods of non-finality and storing everything
 *   will cause OOM.  The pruneToMax will help ensure a hard limit on the number of stored blocks (with DA) that are held
 *   in memory at any one time.  The value for MAX_BLOCK_INPUT_CACHE_SIZE is set to accommodate range-sync but in
 *   practice this value may need to be massaged in the future if we find issues when debugging non-finality
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
      this.metrics?.seenCache.blockInput.duplicateBlockCount.inc({source});
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
      this.metrics?.seenCache.blockInput.duplicateBlobCount.inc({source});
      if (opts.throwErrorIfAlreadyKnown) {
        throw new SeenBlockInputCacheError({
          code: SeenBlockInputCacheErrorCode.GOSSIP_BLOB_ALREADY_KNOWN,
          ...blockInput.getLogMeta(),
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
      daOutOfRange: isDaOutOfRange(this.config, forkName, slot, this.clock.currentEpoch),
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
      for (const [rootHex] of sorted) {
        this.blockInputs.delete(rootHex);
        itemsToDelete--;
        if (itemsToDelete <= 0) return;
      }
    }
  }
}

enum SeenBlockInputCacheErrorCode {
  WRONG_BLOCK_INPUT_TYPE = "BLOCK_INPUT_CACHE_ERROR_WRONG_BLOCK_INPUT_TYPE",
  GOSSIP_BLOB_ALREADY_KNOWN = "BLOCK_INPUT_CACHE_ERROR_GOSSIP_BLOB_ALREADY_KNOWN",
}

type SeenBlockInputCacheErrorType =
  | (LogMetaBasic & {
      code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE;
      cachedType: DAType;
      requestedType: DAType;
    })
  | (LogMetaBlobs & {
      code: SeenBlockInputCacheErrorCode.GOSSIP_BLOB_ALREADY_KNOWN;
    });

class SeenBlockInputCacheError extends LodestarError<SeenBlockInputCacheErrorType> {}
