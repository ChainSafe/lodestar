import {ForkPostDeneb, ForkPostFulu, isForkPostDeneb} from "@lodestar/params";
import {SignedBeaconBlock} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBlobKzgCommitments} from "../../util/dataColumns.js";
import {BeaconChain} from "../chain.js";
import {IBlockInput, IDataColumnsInput, isBlockInputColumns} from "./blockInput/index.js";
import {BLOB_AVAILABILITY_TIMEOUT} from "./verifyBlocksDataAvailability.js";

/**
 * Persists block input data to DB. This operation must be eventually completed if a block is imported to the fork-choice.
 * Else the node will be in an inconsistent state that can lead to being stuck.
 *
 * This operation may be performed before, during or after importing to the fork-choice. As long as errors
 * are handled properly for eventual consistency.
 */
export async function writeBlockInputToDb(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
  const promises: Promise<void>[] = [writeBlockToDb.call(this, blockInput)];

  if (isBlockInputColumns(blockInput)) {
    promises.push(writeDataColumnsToDb.call(this, blockInput));
  }

  await Promise.all(promises);
  this.logger.debug("Persisted blockInput to db", {slot: blockInput.slot, root: blockInput.blockRootHex});
}

async function writeBlockToDb(this: BeaconChain, blockInput: IBlockInput): Promise<void> {
  const block = blockInput.getBlock();
  const slot = block.message.slot;
  const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);
  const numBlobs = isForkPostDeneb(blockInput.forkName)
    ? getBlobKzgCommitments(blockInput.forkName, block as SignedBeaconBlock<ForkPostDeneb>).length
    : undefined;
  this.logger.debug("Persist block to hot DB", {slot, root: blockRootHex, inputType: blockInput.type, numBlobs});

  const blockBytes = this.serializedCache.get(block);
  if (blockBytes) {
    // skip serializing data if we already have it
    this.metrics?.importBlock.persistBlockWithSerializedDataCount.inc();
    await this.db.block.putBinary(this.db.block.getId(block), blockBytes);
  } else {
    this.metrics?.importBlock.persistBlockNoSerializedDataCount.inc();
    await this.db.block.add(block);
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
