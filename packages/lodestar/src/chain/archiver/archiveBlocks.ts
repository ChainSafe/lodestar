import {fromHexString} from "@chainsafe/ssz";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {BlockArchiveBatchPutBinaryItem} from "../../db/repositories";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {LightClientServer} from "../lightClient";

// Process in chunks to avoid OOM
// this number of blocks per chunk is tested in e2e test blockArchive.test.ts
// TODO: Review after merge since the size of blocks will increase significantly
const BATCH_SIZE = 256;

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
  db: IBeaconDb,
  forkChoice: IForkChoice,
  lightclientServer: LightClientServer,
  logger: ILogger,
  finalizedCheckpoint: {rootHex: string; epoch: Epoch}
): Promise<void> {
  // Use fork choice to determine the blocks to archive and delete
  const finalizedCanonicalBlocks = forkChoice.getAllAncestorBlocks(finalizedCheckpoint.rootHex);
  const finalizedNonCanonicalBlocks = forkChoice.getAllNonAncestorBlocks(finalizedCheckpoint.rootHex);

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
  }

  // deleteNonCanonicalBlocks
  // loop through forkchoice single time

  const nonCanonicalBlockRoots = finalizedNonCanonicalBlocks.map((summary) => fromHexString(summary.blockRoot));
  if (nonCanonicalBlockRoots.length > 0) {
    await db.block.batchDelete(nonCanonicalBlockRoots);
    logger.verbose("deleteNonCanonicalBlocks", {
      slots: finalizedNonCanonicalBlocks.map((summary) => summary.slot).join(","),
    });
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
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const toIdx = Math.min(i + BATCH_SIZE, blocks.length);
    const canonicalBlocks = blocks.slice(i, toIdx);

    // processCanonicalBlocks
    if (canonicalBlocks.length === 0) return;

    // load Buffer instead of SignedBeaconBlock to improve performance
    const canonicalBlockEntries: BlockArchiveBatchPutBinaryItem[] = await Promise.all(
      canonicalBlocks.map(async (block) => {
        const blockBuffer = await db.block.getBinary(block.root);
        if (!blockBuffer) {
          throw Error(`No block found for slot ${block.slot} root ${block.root}`);
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
