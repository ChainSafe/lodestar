import {fromHexString} from "@chainsafe/ssz";
import {CheckpointWithHex, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {BlockArchiveBatchPutBinaryItem} from "../../db/repositories";

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
  logger: ILogger,
  finalized: CheckpointWithHex
): Promise<void> {
  // Use fork choice to determine the blocks to archive and delete
  const allCanonicalBlocks = forkChoice.getAllAncestorBlocks(finalized.rootHex);
  // 1st block in iterateAncestorBlocks() is the finalized block itself
  // we move it to blockArchive but forkchoice still have it to check next onBlock calls
  // the next iterateAncestorBlocks call does not return this block
  let i = 0;
  // this number of blocks per chunk is tested in e2e test blockArchive.test.ts
  const BATCH_SIZE = 1000;
  // process in chunks to avoid OOM
  while (i < allCanonicalBlocks.length) {
    const upperBound = Math.min(i + BATCH_SIZE, allCanonicalBlocks.length);
    const canonicalBlocks = allCanonicalBlocks.slice(i, upperBound);

    // processCanonicalBlocks
    if (canonicalBlocks.length === 0) return;

    // load Buffer instead of SignedBeaconBlock to improve performance
    const canonicalBlockEntries: BlockArchiveBatchPutBinaryItem[] = (
      await Promise.all(
        canonicalBlocks.map(async (block) => {
          const blockRootHex = block.blockRoot;
          const blockRoot = fromHexString(blockRootHex);
          const blockBuffer = await db.block.getBinary(blockRoot);
          if (!blockBuffer) {
            throw Error(`No block found for slot ${block.slot} root ${block.blockRoot}`);
          }
          return {
            key: block.slot,
            value: blockBuffer,
            slot: block.slot,
            blockRoot,
            parentRoot: fromHexString(block.parentRoot),
          };
        })
      )
    ).filter((kv) => kv.value);
    // put to blockArchive db and delete block db
    await Promise.all([
      db.blockArchive.batchPutBinary(canonicalBlockEntries),
      db.block.batchDelete(canonicalBlocks.map((block) => fromHexString(block.blockRoot))),
    ]);
    logger.verbose("Archive Blocks: processed chunk", {
      lowerBound: i,
      upperBound,
      size: allCanonicalBlocks.length,
    });
    i = upperBound;
  }

  // deleteNonCanonicalBlocks
  // loop through forkchoice single time
  const nonCanonicalSummaries = forkChoice.getAllNonAncestorBlocks(finalized.rootHex);
  if (nonCanonicalSummaries.length > 0) {
    await db.block.batchDelete(nonCanonicalSummaries.map((summary) => fromHexString(summary.blockRoot)));
    logger.verbose("deleteNonCanonicalBlocks", {
      slots: nonCanonicalSummaries.map((summary) => summary.slot).join(","),
    });
  }
  logger.verbose("Archiving of finalized blocks complete", {
    totalArchived: allCanonicalBlocks.length,
    finalizedEpoch: finalized.epoch,
  });
}
