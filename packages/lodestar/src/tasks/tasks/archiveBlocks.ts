/**
 * @module tasks
 */

import {computeEpochAtSlot, epochToCurrentForkVersion} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {ILogger, toHex, fromHex} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db/api";
import {ITask} from "../interface";
export interface IArchiveBlockModules {
  db: IBeaconDb;
  forkChoice: IForkChoice;
  logger: ILogger;
}

/**
 * Archives finalized blocks from active bucket to archive bucket.
 */
export class ArchiveBlocksTask implements ITask {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: IForkChoice;
  private readonly logger: ILogger;

  private finalized: Checkpoint;

  public constructor(config: IBeaconConfig, modules: IArchiveBlockModules, finalized: Checkpoint) {
    this.config = config;
    this.db = modules.db;
    this.forkChoice = modules.forkChoice;
    this.logger = modules.logger;
    this.finalized = finalized;
  }

  /**
   * Only archive blocks on the same chain to the finalized checkpoint.
   */
  public async run(): Promise<void> {
    // Use fork choice to determine the blocks to archive and delete
    const allCanonicalSummaries = this.forkChoice.iterateBlockSummaries(this.finalized.root);
    let i = 0;
    // this number of blocks per chunk is tested in e2e test blockArchive.test.ts
    const BATCH_SIZE = 1000;
    // process in chunks to avoid OOM
    while (i < allCanonicalSummaries.length) {
      const upperBound = Math.min(i + BATCH_SIZE, allCanonicalSummaries.length);
      const canonicalSummaries = allCanonicalSummaries.slice(i, upperBound);
      await this.processCanonicalBlocks(canonicalSummaries);
      this.logger.verbose("Archive Blocks: processed chunk", {
        lowerBound: i,
        upperBound,
        size: allCanonicalSummaries.length,
      });
      i = upperBound;
    }
    await this.deleteNonCanonicalBlocks();
    this.logger.verbose("Archiving of finalized blocks complete", {
      totalArchived: allCanonicalSummaries.length,
      finalizedEpoch: this.finalized.epoch,
    });
  }

  private async processCanonicalBlocks(canonicalSummaries: IBlockSummary[]): Promise<void> {
    if (!canonicalSummaries) return;
    // load Buffer instead of SignedBeaconBlock to improve performance
    const canonicalBlockEntries = (
      await Promise.all(
        canonicalSummaries.map(async (summary) => {
          const blockBuffer = (await this.db.block.getBinary(summary.blockRoot))!;
          return {
            key: summary.slot,
            value: blockBuffer,
            fork: epochToCurrentForkVersion(this.config, computeEpochAtSlot(this.config, summary.slot)),
            summary,
          };
        })
      )
    ).filter((kv) => kv.value && kv.fork);
    //group block summaries by fork
    const blocksByFork: Map<string, typeof canonicalBlockEntries> = canonicalBlockEntries.reduce((agg, current) => {
      const arr = agg.get(toHex(current.fork!));
      if (!arr) {
        agg.set(toHex(current.fork!), [current]);
      } else {
        arr.push(current);
      }
      return agg;
    }, new Map());
    // put to blockArchive db and delete block db
    await Promise.all([
      ...Array.from(blocksByFork.entries()).map(([fork, blockSummaries]) =>
        this.db.blockArchive.batchPutBinary(blockSummaries, fromHex(fork))
      ),
      this.db.block.batchDelete(canonicalSummaries.map((summary) => summary.blockRoot)),
    ]);
  }

  private async deleteNonCanonicalBlocks(): Promise<void> {
    // loop through forkchoice single time
    const nonCanonicalSummaries = this.forkChoice.iterateNonAncestors(this.finalized.root);
    await this.db.block.batchDelete(nonCanonicalSummaries.map((summary) => summary.blockRoot));
  }
}
