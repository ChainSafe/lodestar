import {ChainForkConfig} from "@lodestar/config";
import {KeyValue} from "@lodestar/db";
import {CheckpointWithHex, PayloadStatus} from "@lodestar/fork-choice";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch, getBlobDataRetentionStartEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {Logger, fromHex, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {IBeaconChainDb} from "../../../db/index.js";
import type {FinalizedBlockSnapshot, FinalizedProtoSummary} from "../../beaconEngine/interface.js";
import type {IBeaconEngine} from "../../interface.js";

const BLOB_SIDECAR_BATCH_SIZE = 32;

type BlockRootSlot = {slot: Slot; root: Uint8Array};

/**
 * Oldest epoch for which data column sidecars are kept
 */
export function getDataColumnSidecarsMinEpoch(
  config: ChainForkConfig,
  currentEpoch: Epoch,
  archiveDataEpochs?: number
): Epoch {
  return Math.min(getBlobDataRetentionStartEpoch(config, currentEpoch), currentEpoch - (archiveDataEpochs ?? 0));
}

/**
 * Archives finalized blocks from active bucket to archive bucket.
 *
 * Only archive blocks on the same chain to the finalized checkpoint.
 * Each run should move all finalized blocks to blockArhive db to make it consistent
 * to stateArchive, so that the node always work well when we restart.
 * Note that the finalized block still stay in forkchoice to check finalize checkpoint of next onBlock calls,
 * the next run should not reprocess finalzied block of this run.
 */
export async function archiveBlocks(
  config: ChainForkConfig,
  db: IBeaconChainDb,
  engine: IBeaconEngine,
  snapshot: FinalizedBlockSnapshot,
  logger: Logger,
  finalizedCheckpoint: CheckpointWithHex,
  currentEpoch: Epoch,
  archiveDataEpochs?: number,
  persistOrphanedBlocks?: boolean,
  persistOrphanedBlocksDir?: string
): Promise<void> {
  // TODO - beacon engine: review this, may let BeaconEngine lead this
  const {canonical: finalizedCanonicalBlocks, nonCanonical: finalizedNonCanonicalBlocks} = snapshot;

  // NOTE: The finalized block will be exactly the first block of `epoch` or previous
  const finalizedPostDeneb = finalizedCheckpoint.epoch >= config.DENEB_FORK_EPOCH;
  const finalizedPostFulu = finalizedCheckpoint.epoch >= config.FULU_FORK_EPOCH;
  const finalizedPostGloas = finalizedCheckpoint.epoch >= config.GLOAS_FORK_EPOCH;

  const finalizedCanonicalBlockRoots: BlockRootSlot[] = finalizedCanonicalBlocks.map((block) => ({
    slot: block.slot,
    root: fromHex(block.blockRoot),
  }));

  const logCtx = {currentEpoch, finalizedEpoch: finalizedCheckpoint.epoch, finalizedRoot: finalizedCheckpoint.rootHex};

  if (finalizedCanonicalBlockRoots.length > 0) {
    await engine.migrateCanonicalBlocks();

    if (finalizedPostDeneb) {
      const migratedEntries = await migrateBlobSidecarsFromHotToColdDb(
        config,
        db,
        logger,
        finalizedCanonicalBlockRoots,
        currentEpoch
      );
      logger.verbose("Migrated blobSidecars from hot DB to cold DB", {...logCtx, migratedEntries});
    }

    if (finalizedPostGloas) {
      // [beacon-engine] Keep upstream's envelope migration at this point in archiveBlocks;
      // the engine selects canonical envelopes from its own fork choice.
      await engine.migrateExecutionPayloadEnvelopes();
    }
  }

  const canonicalRoots = new Set(finalizedCanonicalBlocks.map((block) => block.blockRoot));
  const orphanedBlocks: FinalizedProtoSummary[] = [];
  const orphanedPayloads: FinalizedProtoSummary[] = [];

  for (const block of finalizedNonCanonicalBlocks) {
    if (block.payloadStatus === PayloadStatus.FULL) {
      orphanedPayloads.push(block);
    }
    // Every Gloas block gets EMPTY before FULL. If only FULL survives pruning, an earlier archive run
    // already handled the root's block-level data.
    const isBlockNode = config.getForkSeq(block.slot) < ForkSeq.gloas || block.payloadStatus === PayloadStatus.EMPTY;
    if (isBlockNode && !canonicalRoots.has(block.blockRoot)) {
      orphanedBlocks.push(block);
    }
  }
  const orphanedBlockRoots = orphanedBlocks.map((block) => fromHex(block.blockRoot));

  if (orphanedPayloads.length > 0) {
    const orphanedPayloadRoots = orphanedPayloads.map((block) => fromHex(block.blockRoot));
    const orphanedPayloadLogCtx = {
      ...logCtx,
      count: orphanedPayloads.length,
      slotRange: prettyPrintIndices(orphanedPayloads.map((block) => block.slot).sort((a, b) => a - b)),
    };

    const columnItems = orphanedPayloads
      .filter((block) => config.getForkSeq(block.slot) >= ForkSeq.fulu)
      .map((block) => ({slot: block.slot, blockRoot: block.blockRoot}));
    if (columnItems.length > 0) {
      // Delete sidecars first so their block roots remain available to retry cleanup after a failure or crash.
      await db.dataColumns.deleteMany(columnItems);
      logger.verbose("Deleted non canonical data columns of blocks", {
        ...logCtx,
        blocks: columnItems.length,
        slotRange: prettyPrintIndices(columnItems.map(({slot}) => slot).sort((a, b) => a - b)),
      });
    }

    if (finalizedPostDeneb) {
      await db.blobSidecars.batchDelete(orphanedPayloadRoots);
      logger.verbose("Deleted non canonical blobSidecars from hot DB", orphanedPayloadLogCtx);
    }

    if (finalizedPostGloas) {
      await engine.deleteNonCanonicalExecutionPayloadEnvelopes(orphanedPayloadRoots);
      logger.verbose("Deleted non canonical executionPayloadEnvelopes from hot DB", orphanedPayloadLogCtx);
    }
  }

  if (orphanedBlocks.length > 0) {
    if (persistOrphanedBlocks) {
      await engine.persistOrphanedBlocks(orphanedBlocks, persistOrphanedBlocksDir);
    }

    await engine.deleteNonCanonicalBlocks(orphanedBlockRoots);
    logger.verbose("Deleted non canonical blocks from hot DB", {
      ...logCtx,
      count: orphanedBlocks.length,
      slotRange: prettyPrintIndices(orphanedBlocks.map((block) => block.slot).sort((a, b) => a - b)),
    });
  }

  // Delete expired blobs
  // Keep only `[current_epoch - max(MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS, archiveDataEpochs)]`
  // if archiveDataEpochs set to Infinity do not prune`
  if (finalizedPostDeneb) {
    if (archiveDataEpochs !== Infinity) {
      const blobsArchiveWindow = Math.max(config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS, archiveDataEpochs ?? 0);
      const blobSidecarsMinEpoch = currentEpoch - blobsArchiveWindow;
      if (blobSidecarsMinEpoch >= config.DENEB_FORK_EPOCH) {
        const slotsToDelete = await db.blobSidecarsArchive.keys({lt: computeStartSlotAtEpoch(blobSidecarsMinEpoch)});
        if (slotsToDelete.length > 0) {
          await db.blobSidecarsArchive.batchDelete(slotsToDelete);
          logger.verbose(`blobSidecars prune: batchDelete range ${slotsToDelete[0]}..${slotsToDelete.at(-1)}`, logCtx);
        } else {
          logger.verbose(`blobSidecars prune: no entries before epoch ${blobSidecarsMinEpoch}`, logCtx);
        }
      }
    } else {
      logger.verbose("blobSidecars pruning skipped: archiveDataEpochs set to Infinity", logCtx);
    }
  }

  // Delete expired data column sidecars
  // Keep only `[min(compute_blob_data_retention_start_epoch(current_epoch), current_epoch - archiveDataEpochs)]`
  if (finalizedPostFulu) {
    if (archiveDataEpochs !== Infinity) {
      const dataColumnSidecarsMinEpoch = getDataColumnSidecarsMinEpoch(config, currentEpoch, archiveDataEpochs);
      if (dataColumnSidecarsMinEpoch >= config.FULU_FORK_EPOCH) {
        const columnsPruneSlot = computeStartSlotAtEpoch(dataColumnSidecarsMinEpoch);
        const prunedColumnSlots = await db.dataColumns.pruneBefore(columnsPruneSlot);
        if (prunedColumnSlots.length > 0) {
          logger.verbose("dataColumnSidecars prune", {
            ...logCtx,
            slotRange: prettyPrintIndices(prunedColumnSlots),
            numOfSlots: prunedColumnSlots.length,
          });
        } else {
          logger.verbose("dataColumnSidecars prune: no entries before slot", {...logCtx, slot: columnsPruneSlot});
        }
      } else {
        logger.verbose(
          `dataColumnSidecars pruning skipped: ${dataColumnSidecarsMinEpoch} is before fulu fork epoch ${config.FULU_FORK_EPOCH}`,
          logCtx
        );
      }
    } else {
      logger.verbose("dataColumnSidecars pruning skipped: archiveDataEpochs set to Infinity", logCtx);
    }
  }

  // Pruning potential checkpoint data
  const finalizedCanonicalNonCheckpointBlocks = getNonCheckpointBlocks(finalizedCanonicalBlockRoots);
  const nonCheckpointBlockRoots: Uint8Array[] = [...orphanedBlockRoots];
  for (const block of finalizedCanonicalNonCheckpointBlocks) {
    nonCheckpointBlockRoots.push(block.root);
  }

  await engine.pruneLightClientNonCheckpointData(nonCheckpointBlockRoots);

  logger.verbose("Archiving of finalized blocks complete", {
    ...logCtx,
    totalArchived: finalizedCanonicalBlocks.length,
  });
}

/**
 * Migrate blobSidecars from hot db to cold db.
 * @returns true if we do that, false if block is out of range data.
 */
async function migrateBlobSidecarsFromHotToColdDb(
  config: ChainForkConfig,
  db: IBeaconChainDb,
  logger: Logger,
  blocks: BlockRootSlot[],
  currentEpoch: Epoch
): Promise<number> {
  let migratedWrappedBlobSidecars = 0;
  for (let i = 0; i < blocks.length; i += BLOB_SIDECAR_BATCH_SIZE) {
    const toIdx = Math.min(i + BLOB_SIDECAR_BATCH_SIZE, blocks.length);
    const canonicalBlocks = blocks.slice(i, toIdx);

    // processCanonicalBlocks
    if (canonicalBlocks.length === 0) break;

    // load Buffer instead of ssz deserialized to improve performance
    const canonicalBlobSidecarsEntries: KeyValue<Slot, Uint8Array>[] = (
      await Promise.all(
        canonicalBlocks
          .filter((block) => {
            const blockSlot = block.slot;
            const blockEpoch = computeEpochAtSlot(blockSlot);
            const forkSeq = config.getForkSeq(blockSlot);
            return (
              forkSeq >= ForkSeq.deneb &&
              forkSeq < ForkSeq.fulu &&
              // if block is out of ${config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS}, skip this step
              blockEpoch >= currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
            );
          })
          .map(async (block): Promise<KeyValue<Slot, Uint8Array> | null> => {
            // The ancestor walk includes the boundary (previous finalized) block; on first
            // finalization that boundary is the anchor which has no blob sidecars in hot db.
            // Treat a null hot-db entry as "nothing to migrate" rather than an error.
            const bytes = await db.blobSidecars.getBinary(block.root);
            if (!bytes) {
              logger.debug("BlobSidecars in forkchoice but missing in hot db, could be already archived", {
                slot: block.slot,
                root: toRootHex(block.root),
              });
              return null;
            }
            return {key: block.slot, value: bytes};
          })
      )
    ).filter((e): e is KeyValue<Slot, Uint8Array> => e !== null);

    await Promise.all([
      db.blobSidecarsArchive.batchPutBinary(canonicalBlobSidecarsEntries),
      db.blobSidecars.batchDelete(canonicalBlocks.map((block) => block.root)),
    ]);
    migratedWrappedBlobSidecars += canonicalBlobSidecarsEntries.length;
  }

  return migratedWrappedBlobSidecars;
}

/**
 *
 * @param blocks sequence of linear blocks, from child to ancestor.
 * In ProtoArray.getAllAncestorNodes child nodes are pushed first to the returned array.
 */
export function getNonCheckpointBlocks<T extends {slot: Slot}>(blocks: T[]): T[] {
  // Iterate from lowest child to highest ancestor
  // Look for the checkpoint of the lowest epoch
  // If block at `epoch * SLOTS_PER_EPOCH`, it's a checkpoint.
  // - Then for the previous epoch all blocks but the 0 are NOT checkpoints
  // - Otherwise for the previous epoch the last block is a checkpoint

  if (blocks.length < 1) {
    return [];
  }

  const nonCheckpointBlocks: T[] = [];
  // Start with Infinity to always trigger `blockEpoch < epochPtr` in the first loop
  let epochPtr = Infinity;
  // Assume worst case, since it's unknown if a future epoch will skip the first slot or not.
  // This function must return only blocks that are guaranteed to never become checkpoints.
  let epochPtrHasFirstSlot = false;

  // blocks order: from child to ancestor, decreasing slot
  for (let i = 0; i < blocks.length; i++) {
    let isCheckpoint = false;
    const block = blocks[i];
    const blockEpoch = computeEpochAtSlot(block.slot);

    if (blockEpoch < epochPtr) {
      // If future epoch has skipped the first slot, the last block in the previous epoch is a checkpoint
      if (!epochPtrHasFirstSlot) {
        isCheckpoint = true;
      }

      // Reset epoch pointer
      epochPtr = blockEpoch;
      epochPtrHasFirstSlot = false;
    }

    // The block in the first slot of an epoch is always a checkpoint slot
    if (block.slot % SLOTS_PER_EPOCH === 0) {
      epochPtrHasFirstSlot = true;
      isCheckpoint = true;
    }

    if (!isCheckpoint) {
      nonCheckpointBlocks.push(block);
    }
  }

  return nonCheckpointBlocks;
}
