import {fulu} from "@lodestar/types";
import {prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../chain.js";
import {IBlockInput, isBlockInputBlobs, isBlockInputColumns} from "./blockInput/index.js";
import {BLOB_AVAILABILITY_TIMEOUT} from "./verifyBlocksDataAvailability.js";

/**
 * Persists block input data to DB. This operation must be eventually completed if a block is imported to the fork-choice.
 * Else the node will be in an inconsistent state that can lead to being stuck.
 *
 * This operation may be performed before, during or after importing to the fork-choice. As long as errors
 * are handled properly for eventual consistency.
 */
export async function writeBlockInputToDb(this: BeaconChain, blocksInputs: IBlockInput[]): Promise<void> {
  const fnPromises: Promise<void>[] = [];
  // track slots for logging
  const slots: number[] = [];

  for (const blockInput of blocksInputs) {
    const block = blockInput.getBlock();
    const slot = block.message.slot;
    slots.push(slot);
    const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);
    const blockBytes = this.serializedCache.get(block);
    if (blockBytes) {
      // skip serializing data if we already have it
      this.metrics?.importBlock.persistBlockWithSerializedDataCount.inc();
      fnPromises.push(this.db.block.putBinary(this.db.block.getId(block), blockBytes));
    } else {
      this.metrics?.importBlock.persistBlockNoSerializedDataCount.inc();
      fnPromises.push(this.db.block.add(block));
    }

    this.logger.debug("Persist block to hot DB", {
      slot: block.message.slot,
      root: blockRootHex,
      inputType: blockInput.type,
    });

    if (!blockInput.hasAllData()) {
      await blockInput.waitForAllData(BLOB_AVAILABILITY_TIMEOUT);
    }

    // NOTE: Old data is pruned on archive
    if (isBlockInputColumns(blockInput)) {
      const {custodyColumns} = this.custodyConfig;
      const blobsLen = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;
      let dataColumnsLen: number;
      if (blobsLen === 0) {
        dataColumnsLen = 0;
      } else {
        dataColumnsLen = custodyColumns.length;
      }

      const dataColumnSidecars = blockInput.getCustodyColumns();
      if (dataColumnSidecars.length !== dataColumnsLen) {
        this.logger.debug(
          `Invalid dataColumnSidecars=${dataColumnSidecars.length} for custody expected custodyColumnsLen=${dataColumnsLen}`
        );
      }

      fnPromises.push(this.db.dataColumnSidecar.putMany(blockRoot, dataColumnSidecars));
      this.logger.debug("Persisted dataColumnSidecars to hot DB", {
        slot: block.message.slot,
        root: blockRootHex,
        dataColumnSidecars: dataColumnSidecars.length,
        numBlobs: blobsLen,
        custodyColumns: custodyColumns.length,
      });
    } else if (isBlockInputBlobs(blockInput)) {
      const blobSidecars = blockInput.getBlobs();
      fnPromises.push(this.db.blobSidecars.add({blockRoot, slot: block.message.slot, blobSidecars}));
      this.logger.debug("Persisted blobSidecars to hot DB", {
        blobsLen: blobSidecars.length,
        slot: block.message.slot,
        root: blockRootHex,
      });
    }

    await Promise.all(fnPromises);
    this.logger.debug("Persisted blocksInput to db", {
      blocksInput: blocksInputs.length,
      slots: prettyPrintIndices(slots),
    });
  }
}

/**
 * Prunes eagerly persisted block inputs only if not known to the fork-choice
 */
export async function removeEagerlyPersistedBlockInputs(this: BeaconChain, blockInputs: IBlockInput[]): Promise<void> {
  const blockToRemove = [];
  const blobsToRemove = [];
  const dataColumnsToRemove = [];

  for (const blockInput of blockInputs) {
    const block = blockInput.getBlock();
    const slot = block.message.slot;
    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);
    if (!this.forkChoice.hasBlockHex(blockRootHex)) {
      blockToRemove.push(block);

      if (isBlockInputColumns(blockInput)) {
        const {custodyColumns} = this.custodyConfig;
        const dataColumnsLen = custodyColumns.length;
        const dataColumnSidecars = blockInput.getCustodyColumns();
        if (dataColumnSidecars.length !== dataColumnsLen) {
          throw Error(
            `Invalid dataColumnSidecars=${dataColumnSidecars.length} for custody expected custodyColumnsLen=${dataColumnsLen}`
          );
        }
        dataColumnsToRemove.push(blockRoot);
      } else if (isBlockInputBlobs(blockInput)) {
        const blobSidecars = blockInput.getBlobs();
        blobsToRemove.push({blockRoot, slot, blobSidecars});
      }
    }
  }

  await Promise.all([
    // TODO: Batch DB operations not with Promise.all but with level db ops
    this.db.block.batchRemove(blockToRemove),
    this.db.blobSidecars.batchRemove(blobsToRemove),
    this.db.dataColumnSidecar.deleteMany(dataColumnsToRemove),
  ]);
}
