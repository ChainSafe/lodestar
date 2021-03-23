/**
 * @module tasks
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db/api";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IArchivingStatus} from "../interface";
export interface IArchiveBlockModules {
  db: IBeaconDb;
  forkChoice: IForkChoice;
  logger: ILogger;
}

/**
 * Archives finalized blocks from active bucket to archive bucket.
 */
export class ArchiveBlocksTask {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: IForkChoice;
  private readonly logger: ILogger;

  private finalizingSlot: number | null;
  private lastFinalizedSlot = 0;
  // beacon_blocks_by_range handlers waiting for this
  private subscribedPromises: (() => void)[];

  constructor(config: IBeaconConfig, modules: IArchiveBlockModules) {
    this.config = config;
    this.db = modules.db;
    this.forkChoice = modules.forkChoice;
    this.logger = modules.logger;
    this.finalizingSlot = null;
    this.subscribedPromises = [];
  }

  /**
   * Initialize the task with a last finalized block from db.
   */
  init(lastFinalizedSlot: number): void {
    this.lastFinalizedSlot = lastFinalizedSlot;
  }

  /**
   * Only archive blocks on the same chain to the finalized checkpoint.
   */
  async run(finalizedCheckpoint: phase0.Checkpoint): Promise<void> {
    this.finalizingSlot = computeStartSlotAtEpoch(this.config, finalizedCheckpoint.epoch);
    // Use fork choice to determine the blocks to archive and delete
    const allCanonicalSummaries = this.forkChoice.iterateBlockSummaries(finalizedCheckpoint.root);
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
    await this.deleteNonCanonicalBlocks(finalizedCheckpoint);
    this.logger.verbose("Archiving of finalized blocks complete", {
      totalArchived: allCanonicalSummaries.length,
      finalizedEpoch: finalizedCheckpoint.epoch,
    });
    this.lastFinalizedSlot = this.finalizingSlot;
    this.finalizingSlot = null;
    this.subscribedPromises.forEach((resolve) => resolve());
    this.subscribedPromises = [];
  }

  /**
   * Returns the blocks being moved from blocks db to archivedBlocks db.
   */
  getArchivingStatus(): IArchivingStatus {
    return {
      lastFinalizedSlot: this.lastFinalizedSlot,
      finalizingSlot: this.finalizingSlot,
    };
  }

  /**
   * Wait for run() to be done.
   */
  waitUntilComplete(): Promise<void> {
    return new Promise((resolve) => {
      this.subscribedPromises.push(resolve);
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
            summary,
          };
        })
      )
    ).filter((kv) => kv.value);
    // put to blockArchive db and delete block db
    await Promise.all([
      this.db.blockArchive.batchPutBinary(canonicalBlockEntries),
      this.db.block.batchDelete(canonicalSummaries.map((summary) => summary.blockRoot)),
    ]);
  }

  private async deleteNonCanonicalBlocks(finalizedCheckpoint: phase0.Checkpoint): Promise<void> {
    // loop through forkchoice single time
    const nonCanonicalSummaries = this.forkChoice.iterateNonAncestors(finalizedCheckpoint.root);
    await this.db.block.batchDelete(nonCanonicalSummaries.map((summary) => summary.blockRoot));
  }
}
