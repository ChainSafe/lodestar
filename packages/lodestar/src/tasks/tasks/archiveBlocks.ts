/**
 * @module tasks
 */

import {ITask} from "../interface";
import {IBeaconDb} from "../../db/api";
import {Checkpoint, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString} from "@chainsafe/ssz";

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

  private finalizedCheckpoint: Checkpoint;

  public constructor(config: IBeaconConfig, modules: IArchiveBlockModules, finalizedCheckpoint: Checkpoint) {
    this.db = modules.db;
    this.logger = modules.logger;
    this.config = config;
    this.finalizedCheckpoint = finalizedCheckpoint;
  }

  /**
   * Only archive blocks on the same chain to the finalized checkpoint.
   */
  public async run(): Promise<void> {
    const allBlocks = await this.db.block.values();
    const finalizedBlock = allBlocks.find(block => {
      const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(block.message);
      return this.config.types.Root.equals(blockRoot, this.finalizedCheckpoint.root);
    });
    const blocks = allBlocks.filter(
      (block) =>
        block.message.slot <= finalizedBlock.message.slot
    );
    const blocksByRoot = new Map<string, SignedBeaconBlock>();
    blocks.forEach((block) =>
      blocksByRoot.set(toHexString(this.config.types.BeaconBlock.hashTreeRoot(block.message)), block));
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
    this.logger.info(`Started archiving ${archivedBlocks.length} blocks from slot ${fromSlot} to ${toSlot}`
        +`(finalized epoch #${this.finalizedCheckpoint.epoch})...`
    );
    await Promise.all([
      this.db.blockArchive.batchAdd(archivedBlocks),
      this.db.block.batchRemove(blocks)
    ]);
    this.logger.info(`Archiving of ${archivedBlocks.length} finalized blocks from slot ${fromSlot} to ${toSlot}`
        + ` completed (finalized epoch #${this.finalizedCheckpoint.epoch})`);
  }
}
