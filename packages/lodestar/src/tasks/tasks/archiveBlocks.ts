/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString} from "@chainsafe/ssz";
import {BlockSummary} from "../../chain";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

export interface IArchiveBlockModules {
  db: IBeaconDb;
  logger: ILogger;
}

/**
 * Archives finalized blocks from active bucket to archive bucket.
 */
export class ArchiveBlocksTask implements ITask {

  private readonly db: IBeaconDb;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;

  private finalized: BlockSummary;
  private pruned: BlockSummary[];

  public constructor(
    config: IBeaconConfig, modules: IArchiveBlockModules, finalized: BlockSummary, pruned: BlockSummary[]) {
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalized = finalized;
    this.pruned = pruned;
  }

  /**
   * Only archive blocks on the same chain to the finalized checkpoint.
   */
  public async run(): Promise<void> {
    this.logger.profile("Archive Blocks");
    const allBlockEntries = await this.db.block.entries();
    const blockEntries = allBlockEntries.filter(
      ({value}) => value.message.slot <= this.finalized.slot
    );
    const blocksByRoot = new Map<string, SignedBeaconBlock>(
      blockEntries.map(
        ({key, value}) => ([toHexString(key), value])
      )
    );
    const finalizedBlock = blocksByRoot.get(toHexString(this.finalized.blockRoot));
    const archivedBlocks = [finalizedBlock];
    let lastBlock = finalizedBlock;
    while (lastBlock) {
      lastBlock = blocksByRoot.get(toHexString(lastBlock.message.parentRoot));
      if (lastBlock) {
        archivedBlocks.push(lastBlock);
      }
    }
    const fromSlot = (archivedBlocks.length > 0)? archivedBlocks[archivedBlocks.length - 1].message.slot : undefined;
    const toSlot = (archivedBlocks.length > 0)? archivedBlocks[0].message.slot : undefined;
    const epoch = computeEpochAtSlot(this.config, this.finalized.slot);

    this.logger.info(`Started archiving ${archivedBlocks.length} blocks from slot ${fromSlot} to ${toSlot}`
        +`(finalized epoch #${epoch})...`
    );
    await Promise.all([
      this.db.blockArchive.batchAdd(archivedBlocks),
      this.db.block.batchDelete(blockEntries.map(({key}) => key)),
    ]);
    this.logger.profile("Archive Blocks");
    this.logger.info(`Archiving of ${archivedBlocks.length} finalized blocks from slot ${fromSlot} to ${toSlot}`
        + ` completed (finalized epoch #${epoch})`);
  }
}
