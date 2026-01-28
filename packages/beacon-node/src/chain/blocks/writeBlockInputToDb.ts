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

      const binaryPuts = [];
      const nonbinaryPuts = [];
      for (const dataColumnSidecar of dataColumnSidecars) {
        // skip reserializing column if we already have it
        const serialized = this.serializedCache.get(dataColumnSidecar);
        if (serialized) {
          binaryPuts.push({key: dataColumnSidecar.index, value: serialized});
        } else {
          nonbinaryPuts.push(dataColumnSidecar);
        }
      }
      fnPromises.push(this.db.dataColumnSidecar.putManyBinary(blockRoot, binaryPuts));
      fnPromises.push(this.db.dataColumnSidecar.putMany(blockRoot, nonbinaryPuts));
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

export async function persistBlockInputs(this: BeaconChain, blockInputs: IBlockInput[]): Promise<void> {
  await writeBlockInputToDb
    .call(this, blockInputs)
    .catch((e) => {
      this.logger.debug(
        "Error persisting block input in hot db",
        {
          count: blockInputs.length,
          slot: blockInputs[0].slot,
          root: blockInputs[0].blockRootHex,
        },
        e
      );
    })
    .finally(() => {
      for (const blockInput of blockInputs) {
        this.seenBlockInputCache.prune(blockInput.blockRootHex);
      }
      if (blockInputs.length === 1) {
        this.logger.debug("Pruned block input", {
          slot: blockInputs[0].slot,
          root: blockInputs[0].blockRootHex,
        });
      }
    });
}
