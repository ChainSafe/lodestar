import {fromHexString} from "@chainsafe/ssz";
import {Epoch, Slot} from "@lodestar/types";
import {IForkChoice} from "@lodestar/fork-choice";
import {Logger, toHex} from "@lodestar/utils";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {KeyValue} from "@lodestar/db";
import {ChainForkConfig} from "@lodestar/config";
import {IBeaconDb} from "../../db/index.js";
import {BlockArchiveBatchPutBinaryItem} from "../../db/repositories/index.js";
import {LightClientServer} from "../lightClient/index.js";

// Process in chunks to avoid OOM
// this number of blocks per chunk is tested in e2e test blockArchive.test.ts
// TODO: Review after merge since the size of blocks will increase significantly
const BLOCK_BATCH_SIZE = 256;
const BLOB_SIDECAR_BATCH_SIZE = 32;

type BlockRootSlot = {slot: Slot; root: Uint8Array};

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
  db: IBeaconDb,
  forkChoice: IForkChoice,
  lightclientServer: LightClientServer,
  logger: Logger,
  finalizedCheckpoint: {rootHex: string; epoch: Epoch},
  currentEpoch: Epoch
): Promise<void> {
  // Use fork choice to determine the blocks to archive and delete
  const finalizedCanonicalBlocks = forkChoice.getAllAncestorBlocks(finalizedCheckpoint.rootHex);
  const finalizedNonCanonicalBlocks = forkChoice.getAllNonAncestorBlocks(finalizedCheckpoint.rootHex);

  // NOTE: The finalized block will be exactly the first block of `epoch` or previous
  const finalizedPostDeneb = finalizedCheckpoint.epoch >= config.EIP4844_FORK_EPOCH;

  const finalizedCanonicalBlockRoots: BlockRootSlot[] = finalizedCanonicalBlocks.map((block) => ({
    slot: block.slot,
    root: fromHexString(block.blockRoot),
  }));

  if (finalizedCanonicalBlockRoots.length > 0) {
    await migrateBlocksFromHotToColdDb(db, finalizedCanonicalBlockRoots);
    logger.verbose("Migrated blocks from hot DB to cold DB", {
      fromSlot: finalizedCanonicalBlockRoots[0].slot,
      toSlot: finalizedCanonicalBlockRoots[finalizedCanonicalBlockRoots.length - 1].slot,
      size: finalizedCanonicalBlockRoots.length,
    });

    if (finalizedPostDeneb) {
      await migrateBlobsSidecarFromHotToColdDb(config, db, finalizedCanonicalBlockRoots);
      logger.verbose("Migrated blobsSidecar from hot DB to cold DB");
    }
  }

  // deleteNonCanonicalBlocks
  // loop through forkchoice single time

  const nonCanonicalBlockRoots = finalizedNonCanonicalBlocks.map((summary) => fromHexString(summary.blockRoot));
  if (nonCanonicalBlockRoots.length > 0) {
    await db.block.batchDelete(nonCanonicalBlockRoots);
    logger.verbose("Deleted non canonical blocks from hot DB", {
      slots: finalizedNonCanonicalBlocks.map((summary) => summary.slot).join(","),
    });

    if (finalizedPostDeneb) {
      await db.blobsSidecar.batchDelete(nonCanonicalBlockRoots);
      logger.verbose("Deleted non canonical blobsSider from hot DB");
    }
  }

  // Delete expired blobs
  // Keep only `[max(GENESIS_EPOCH, current_epoch - MIN_EPOCHS_FOR_BLOBS_SIDECARS_REQUESTS), current_epoch]`
  if (finalizedPostDeneb) {
    const blobsSidecarMinEpoch = currentEpoch - config.MIN_EPOCHS_FOR_BLOBS_SIDECARS_REQUESTS;
    if (blobsSidecarMinEpoch >= config.EIP4844_FORK_EPOCH) {
      const slotsToDelete = await db.blobsSidecarArchive.keys({lt: computeStartSlotAtEpoch(blobsSidecarMinEpoch)});
      if (slotsToDelete.length > 0) {
        await db.blobsSidecarArchive.batchDelete(slotsToDelete);
        logger.verbose(
          `blobsSidecar prune: batchDelete range ${slotsToDelete[0]}..${slotsToDelete[slotsToDelete.length - 1]}`
        );
      } else {
        logger.verbose(`blobsSidecar prune: no entries before epoch ${blobsSidecarMinEpoch}`);
      }
    }
  }

  // Prunning potential checkpoint data
  const finalizedCanonicalNonCheckpointBlocks = getNonCheckpointBlocks(finalizedCanonicalBlockRoots);
  const nonCheckpointBlockRoots: Uint8Array[] = [...nonCanonicalBlockRoots];
  for (const block of finalizedCanonicalNonCheckpointBlocks) {
    nonCheckpointBlockRoots.push(block.root);
  }

  await lightclientServer.pruneNonCheckpointData(nonCheckpointBlockRoots);

  logger.verbose("Archiving of finalized blocks complete", {
    totalArchived: finalizedCanonicalBlocks.length,
    finalizedEpoch: finalizedCheckpoint.epoch,
  });
}

async function migrateBlocksFromHotToColdDb(db: IBeaconDb, blocks: BlockRootSlot[]): Promise<void> {
  // Start from `i=0`: 1st block in iterateAncestorBlocks() is the finalized block itself
  // we move it to blockArchive but forkchoice still have it to check next onBlock calls
  // the next iterateAncestorBlocks call does not return this block
  for (let i = 0; i < blocks.length; i += BLOCK_BATCH_SIZE) {
    const toIdx = Math.min(i + BLOCK_BATCH_SIZE, blocks.length);
    const canonicalBlocks = blocks.slice(i, toIdx);

    // processCanonicalBlocks
    if (canonicalBlocks.length === 0) return;

    // load Buffer instead of SignedBeaconBlock to improve performance
    const canonicalBlockEntries: BlockArchiveBatchPutBinaryItem[] = await Promise.all(
      canonicalBlocks.map(async (block) => {
        const blockBuffer = await db.block.getBinary(block.root);
        if (!blockBuffer) {
          throw Error(`No block found for slot ${block.slot} root ${toHex(block.root)}`);
        }
        return {
          key: block.slot,
          value: blockBuffer,
          slot: block.slot,
          blockRoot: block.root,
          // TODO: Benchmark if faster to slice Buffer or fromHexString()
          parentRoot: getParentRootFromSignedBlock(blockBuffer),
        };
      })
    );

    // put to blockArchive db and delete block db
    await Promise.all([
      db.blockArchive.batchPutBinary(canonicalBlockEntries),
      db.block.batchDelete(canonicalBlocks.map((block) => block.root)),
    ]);
  }
}

async function migrateBlobsSidecarFromHotToColdDb(
  config: ChainForkConfig,
  db: IBeaconDb,
  blocks: BlockRootSlot[]
): Promise<void> {
  for (let i = 0; i < blocks.length; i += BLOB_SIDECAR_BATCH_SIZE) {
    const toIdx = Math.min(i + BLOB_SIDECAR_BATCH_SIZE, blocks.length);
    const canonicalBlocks = blocks.slice(i, toIdx);

    // processCanonicalBlocks
    if (canonicalBlocks.length === 0) return;

    // load Buffer instead of ssz deserialized to improve performance
    const canonicalBlobsSidecarEntries: KeyValue<Slot, Uint8Array>[] = await Promise.all(
      canonicalBlocks
        .filter((block) => config.getForkSeq(block.slot) >= ForkSeq.deneb)
        .map(async (block) => {
          const bytes = await db.blobsSidecar.getBinary(block.root);
          if (!bytes) {
            throw Error(`No blobsSidecar found for slot ${block.slot} root ${toHex(block.root)}`);
          }
          return {key: block.slot, value: bytes};
        })
    );

    // put to blockArchive db and delete block db
    await Promise.all([
      db.blobsSidecarArchive.batchPutBinary(canonicalBlobsSidecarEntries),
      db.blobsSidecar.batchDelete(canonicalBlocks.map((block) => block.root)),
    ]);
  }
}

/**
 * ```
 * class SignedBeaconBlock(Container):
 *   message: BeaconBlock [offset - 4 bytes]
 *   signature: BLSSignature [fixed - 96 bytes]
 *
 * class BeaconBlock(Container):
 *   slot: Slot [fixed - 8 bytes]
 *   proposer_index: ValidatorIndex [fixed - 8 bytes]
 *   parent_root: Root [fixed - 32 bytes]
 *   state_root: Root
 *   body: BeaconBlockBody
 * ```
 * From byte: `4 + 96 + 8 + 8 = 116`
 * To byte: `116 + 32 = 148`
 */
export function getParentRootFromSignedBlock(bytes: Uint8Array): Uint8Array {
  return bytes.slice(116, 148);
}

/**
 *
 * @param blocks sequence of linear blocks, from ancestor to child.
 * In ProtoArray.getAllAncestorNodes child nodes are pushed to the returned array.
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

  // blocks order: from ancestor to child, increasing slot
  // Iterate in reverse: from child to ancestor, decreasing slot
  for (let i = blocks.length - 1; i >= 0; i--) {
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
