import {fromHex, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../chain.js";
import {IBlockInput, IDataColumnsInput, isBlockInputBlobs, isBlockInputColumns} from "./blockInput/index.js";
import {BLOB_AVAILABILITY_TIMEOUT} from "./verifyBlocksDataAvailability.js";

/**
 * Persists block input data to DB. This operation must be eventually completed if a block is imported to the fork-choice.
 * Else the node will be in an inconsistent state that can lead to being stuck.
 *
 * This operation may be performed before, during or after importing to the fork-choice. As long as errors
 * are handled properly for eventual consistency.
 *
 * Block+blobs (pre-fulu) and data columns (fulu+) are written in parallel.
 */
export async function writeBlockInputToDb(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
  const promises: Promise<void>[] = [writeBlockAndBlobsToDb.call(this, blockInput)];

  if (isBlockInputColumns(blockInput)) {
    promises.push(writeDataColumnsToDb.call(this, blockInput));
  }

  await Promise.all(promises);
  this.logger.debug("Persisted blockInput to db", {slot: blockInput.slot});
}

async function writeBlockAndBlobsToDb(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
  const block = blockInput.getBlock();
  const slot = block.message.slot;
  const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);

  const blockBytes = this.serializedCache.get(block);
  if (blockBytes) {
    // skip serializing data if we already have it
    this.metrics?.importBlock.persistBlockWithSerializedDataCount.inc();
    await this.db.block.putBinary(this.db.block.getId(block), blockBytes);
  } else {
    this.metrics?.importBlock.persistBlockNoSerializedDataCount.inc();
    await this.db.block.add(block);
  }

  this.logger.debug("Persist block to hot DB", {slot, root: blockRootHex, inputType: blockInput.type});

  if (isBlockInputBlobs(blockInput)) {
    if (!blockInput.hasAllData()) {
      await blockInput.waitForAllData(BLOB_AVAILABILITY_TIMEOUT);
    }
    const blobSidecars = blockInput.getBlobs();
    await this.db.blobSidecars.add({blockRoot, slot, blobSidecars});
    this.logger.debug("Persisted blobSidecars to hot DB", {blobsLen: blobSidecars.length, slot, root: blockRootHex});
  }
}

/**
 * Persists data columns to DB for a given block. Accepts a narrow sub-interface of IBlockInput
 * so it can be reused across forks (e.g. Fulu, Gloas).
 *
 * NOTE: Old data is pruned on archive.
 */
export async function writeDataColumnsToDb(this: BeaconChain, blockInput: IDataColumnsInput): Promise<void> {
  const {slot, blockRootHex} = blockInput;
  const blockRoot = fromHex(blockRootHex);

  if (!blockInput.hasComputedAllData()) {
    // Supernodes may only have a subset of the data columns by the time the block begins to be imported
    // because full data availability can be assumed after NUMBER_OF_COLUMNS / 2 columns are available.
    // Here, however, all data columns must be fully available/reconstructed before persisting to the DB.
    await blockInput.waitForComputedAllData(BLOB_AVAILABILITY_TIMEOUT).catch(() => {
      this.logger.debug("Failed to wait for computed all data", {slot, blockRoot: blockRootHex});
    });
  }

  const {custodyColumns} = this.custodyConfig;
  const dataColumnSidecars = blockInput.getCustodyColumns();

  const binaryPuts: {key: number; value: Uint8Array}[] = [];
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

  await Promise.all([
    this.db.dataColumnSidecar.putManyBinary(blockRoot, binaryPuts),
    this.db.dataColumnSidecar.putMany(blockRoot, nonbinaryPuts),
  ]);

  this.logger.debug("Persisted dataColumnSidecars to hot DB", {
    slot,
    root: blockRootHex,
    dataColumnSidecars: dataColumnSidecars.length,
    custodyColumns: custodyColumns.length,
  });
}

export async function persistBlockInputs(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
  await writeBlockInputToDb
    .call(this, blockInput)
    .catch((e) => {
      this.logger.debug(
        "Error persisting block input in hot db",
        {
          slot: blockInput.slot,
          root: blockInput.blockRootHex,
        },
        e
      );
    })
    .finally(() => {
      this.seenBlockInputCache.prune(blockInput.blockRootHex);
      // Without forcefully clearing this cache, we would rely on WeakMap to evict memory which is not reliable.
      // Clear here (after the DB write) so that writeBlockInputToDb can still use the cached serialized bytes.
      this.serializedCache.clear();
      this.logger.debug("Pruned block input", {
        slot: blockInput.slot,
        root: blockInput.blockRootHex,
      });
    });
}
