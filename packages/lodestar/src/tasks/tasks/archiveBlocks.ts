/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
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
    const finalizedSlot = computeStartSlotAtEpoch(this.config, this.finalized.epoch);
    // Use fork choice to determine the blocks to archive and delete
    const canonicalSummaries = this.forkChoice.iterateBlockSummaries(this.finalized.root);
    const nonCanonicalSummaries = this.forkChoice
      .forwardIterateBlockSummaries()
      .filter(
        (summary) =>
          summary.slot < finalizedSlot && !this.forkChoice.isDescendant(summary.blockRoot, this.finalized.root)
      );
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
    await this.db.blockArchive.batchPut(canonicalBlockEntries);
    // delete all canonical and non-canonical blocks at once
    await this.db.block.batchDelete(
      canonicalSummaries.concat(nonCanonicalSummaries).map((summary) => summary.blockRoot)
    );
    this.logger.profile("Archive Blocks");
    this.logger.info("Archiving of finalized blocks complete.", {
      totalArchived: canonicalSummaries.length,
      finalizedEpoch: this.finalized.epoch,
    });
  }
}
