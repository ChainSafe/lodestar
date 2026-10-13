import {ForkPostFulu} from "@lodestar/params";
import {fromHex} from "@lodestar/utils";
import {BeaconChain} from "../chain.js";
import {IBlockInput, IDataColumnsInput, isBlockInputBlobs, isBlockInputColumns} from "./blockInput/index.js";
import {BLOB_AVAILABILITY_TIMEOUT} from "./verifyBlocksDataAvailability.js";

/** Persists blob sidecars and data columns. Beacon blocks are persisted during engine import. */
export async function writeBlockInputToDb(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
  if (isBlockInputBlobs(blockInput)) {
    if (!blockInput.hasAllData()) {
      await blockInput.waitForAllData(BLOB_AVAILABILITY_TIMEOUT);
    }
    const {slot} = blockInput;
    const blockRoot = fromHex(blockInput.blockRootHex);
    const blobSidecars = blockInput.getBlobs();
    await this.db.blobSidecars.add({blockRoot, slot, blobSidecars});
    this.logger.debug("Persisted blobSidecars to hot DB", {
      slot,
      root: blockInput.blockRootHex,
      numBlobs: blobSidecars.length,
    });
  } else if (isBlockInputColumns(blockInput)) {
    await writeDataColumnsToDb.call(this, blockInput);
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
  const dataColumnSidecarType = this.config.getForkTypes<ForkPostFulu>(slot).DataColumnSidecar;

  const binaryColumns: {index: number; data: Uint8Array}[] = [];
  for (const dataColumnSidecar of dataColumnSidecars) {
    const serialized = this.serializedCache.get(dataColumnSidecar);
    binaryColumns.push({
      index: dataColumnSidecar.index,
      data: serialized ?? dataColumnSidecarType.serialize(dataColumnSidecar),
    });
  }
  await this.db.dataColumns.putManyBinary({slot, blockRoot: blockRootHex}, binaryColumns);

  this.logger.debug("Persisted dataColumnSidecars", {
    slot,
    root: blockRootHex,
    dataColumnSidecars: dataColumnSidecars.length,
    custodyColumns: custodyColumns.length,
    numBlobs: dataColumnSidecars[0]?.column.length,
  });
}

/**
 * Runs on BeaconChain to persist sidecars and prune its block-input, block and sidecar caches.
 * BeaconEngine persists the block in beaconEngine/importBlock.ts before fork-choice import.
 * This cleanup can precede that write; the engine's verified bundle retains the block bytes.
 */
export async function persistBlockInput(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
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
      this.logger.debug("Pruned block input", {
        slot: blockInput.slot,
        root: blockInput.blockRootHex,
      });
    });
}
