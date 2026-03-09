import {ForkPostDeneb, isForkPostDeneb} from "@lodestar/params";
import {SignedBeaconBlock} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getBlobKzgCommitments} from "../../util/dataColumns.js";
import {BeaconChain} from "../chain.js";
import {
  IBlockInput,
  IDataColumnsInput,
  isBlockInputBlobs,
  isBlockInputColumns,
  isBlockInputNoData,
} from "./blockInput/index.js";
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
  this.logger.debug("Persisted blockInput to db", {slot: blockInput.slot, root: blockInput.blockRootHex});
}

async function writeBlockAndBlobsToDb(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
  const block = blockInput.getBlock();
  const slot = block.message.slot;
  const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);
  const numBlobs = isForkPostDeneb(blockInput.forkName)
    ? getBlobKzgCommitments(blockInput.forkName, block as SignedBeaconBlock<ForkPostDeneb>).length
    : undefined;
  const fnPromises: Promise<void>[] = [];

  const blockBytes = this.serializedCache.get(block);
  if (blockBytes) {
    // skip serializing data if we already have it
    this.metrics?.importBlock.persistBlockWithSerializedDataCount.inc();
    fnPromises.push(this.db.block.putBinary(this.db.block.getId(block), blockBytes));
  } else {
    this.metrics?.importBlock.persistBlockNoSerializedDataCount.inc();
    fnPromises.push(this.db.block.add(block));
  }

  this.logger.debug("Persist block to hot DB", {slot, root: blockRootHex, inputType: blockInput.type, numBlobs});

  if (isBlockInputBlobs(blockInput)) {
    fnPromises.push(
      (async () => {
        if (!blockInput.hasAllData()) {
          await blockInput.waitForAllData(BLOB_AVAILABILITY_TIMEOUT);
        }
        const blobSidecars = blockInput.getBlobs();
        await this.db.blobSidecars.add({blockRoot, slot, blobSidecars});
        this.logger.debug("Persisted blobSidecars to hot DB", {
          slot,
          root: blockRootHex,
          numBlobs: blobSidecars.length,
        });
      })()
    );
  }

  await Promise.all(fnPromises);
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
    numBlobs: dataColumnSidecars[0]?.column.length,
  });
}

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
      // Without forcefully clearing this cache, we would rely on WeakMap to evict memory which is not reliable.
      // Clear here (after the DB write) so that writeBlockInputToDb can still use the cached serialized bytes.
      //
      // For Gloas (BlockInputNoData), the execution payload and columns arrive separately after the beacon block.
      // Do NOT clear the cache here — it must remain available for writeDataColumnsToDb when the payload arrives.
      // The cache is cleared in the Gloas payload persistence path instead.
      if (!isBlockInputNoData(blockInput)) {
        // TODO: enhance this SerializedCache for Gloas because payload may not come
        // see https://github.com/ChainSafe/lodestar/pull/8974#discussion_r2885598229
        this.serializedCache.clear();
      }
      this.logger.debug("Pruned block input", {
        slot: blockInput.slot,
        root: blockInput.blockRootHex,
      });
    });
}
