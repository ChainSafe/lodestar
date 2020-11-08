/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";

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
    this.logger.profile("Archive Blocks");
    // Use fork choice to determine the blocks to archive and delete
    const allCanonicalSummaries = this.forkChoice.iterateBlockSummaries(this.finalized.root);
    let i = 0;
    const BATCH_SIZE = 2 * this.config.params.SLOTS_PER_EPOCH;
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
    this.logger.profile("Archive Blocks");
    this.logger.info("Archiving of finalized blocks complete.", {
      totalArchived: allCanonicalSummaries.length,
      finalizedEpoch: this.finalized.epoch,
    });
  }

  private async processCanonicalBlocks(canonicalSummaries: IBlockSummary[]): Promise<void> {
    if (!canonicalSummaries) return;
    // first archive the canonical blocks
    const canonicalBlockEntries = (
      await Promise.all(
        canonicalSummaries.map(async (summary) => {
          const block = (await this.db.block.get(summary.blockRoot))!;
          return {
            key: summary.slot,
            value: block,
          };
        })
      )
    ).filter((kv) => kv.value);
    // put to blockArchive db and delete block db
    await Promise.all([
      this.db.blockArchive.batchPut(canonicalBlockEntries),
      this.db.block.batchDelete(canonicalSummaries.map((summary) => summary.blockRoot)),
    ]);
  }

  private async deleteNonCanonicalBlocks(): Promise<void> {
    const finalizedSlot = computeStartSlotAtEpoch(this.config, this.finalized.epoch);
    const nonCanonicalSummaries = this.forkChoice
      .forwardIterateBlockSummaries()
      .filter(
        (summary) =>
          summary.slot < finalizedSlot && !this.forkChoice.isDescendant(summary.blockRoot, this.finalized.root)
      );
    await this.db.block.batchDelete(nonCanonicalSummaries.map((summary) => summary.blockRoot));
  }
}
