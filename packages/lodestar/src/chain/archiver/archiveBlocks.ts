import {phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";

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
  finalized: phase0.Checkpoint
): Promise<void> {
  // Use fork choice to determine the blocks to archive and delete
  const allCanonicalSummaries = forkChoice.iterateBlockSummaries(finalized.root);
  // 1st block in iterateBlockSummaries() is the finalized block itself
  // we move it to blockArchive but forkchoice still have it to check next onBlock calls
  // the next iterateBlockSummaries call does not return this block
  let i = 0;
  // this number of blocks per chunk is tested in e2e test blockArchive.test.ts
  const BATCH_SIZE = 1000;
  // process in chunks to avoid OOM
  while (i < allCanonicalSummaries.length) {
    const upperBound = Math.min(i + BATCH_SIZE, allCanonicalSummaries.length);
    const canonicalSummaries = allCanonicalSummaries.slice(i, upperBound);

    // processCanonicalBlocks
    if (!canonicalSummaries) return;
    // load Buffer instead of SignedBeaconBlock to improve performance
    const canonicalBlockEntries = (
      await Promise.all(
        canonicalSummaries.map(async (summary) => {
          const blockBuffer = await db.block.getBinary(summary.blockRoot);
          if (!blockBuffer) {
            throw Error(`No block found for slot ${summary.slot} root ${toHexString(summary.blockRoot)}`);
          }
          return {
            key: summary.slot,
            value: blockBuffer,
            summary,
          };
        })
      )
    ).filter((kv) => kv.value);
    // put to blockArchive db and delete block db
    await Promise.all([
      db.blockArchive.batchPutBinary(canonicalBlockEntries),
      db.block.batchDelete(canonicalSummaries.map((summary) => summary.blockRoot)),
    ]);
    logger.verbose("Archive Blocks: processed chunk", {
      lowerBound: i,
      upperBound,
      size: allCanonicalSummaries.length,
    });
    i = upperBound;
  }

  // deleteNonCanonicalBlocks
  // loop through forkchoice single time
  const nonCanonicalSummaries = forkChoice.iterateNonAncestors(finalized.root);
  if (nonCanonicalSummaries && nonCanonicalSummaries.length > 0) {
    await db.block.batchDelete(nonCanonicalSummaries.map((summary) => summary.blockRoot));
    logger.verbose("deleteNonCanonicalBlocks", {
      slots: nonCanonicalSummaries.map((summary) => summary.slot).join(","),
    });
  }
  logger.verbose("Archiving of finalized blocks complete", {
    totalArchived: allCanonicalSummaries.length,
    finalizedEpoch: finalized.epoch,
  });
}
