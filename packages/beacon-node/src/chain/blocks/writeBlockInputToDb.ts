import {ForkName, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {fulu} from "@lodestar/types";
import {prettyPrintIndices, toHex, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../chain.js";
import {BlockInput, BlockInputBlobs, BlockInputDataColumns, BlockInputType} from "./types.js";

/**
 * Persists block input data to DB. This operation must be eventually completed if a block is imported to the fork-choice.
 * Else the node will be in an inconsistent state that can lead to being stuck.
 *
 * This operation may be performed before, during or after importing to the fork-choice. As long as errors
 * are handled properly for eventual consistency.
 */
export async function writeBlockInputToDb(this: BeaconChain, blocksInput: BlockInput[]): Promise<void> {
  const fnPromises: Promise<void>[] = [];

  for (const blockInput of blocksInput) {
    const {block} = blockInput;
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

    if (blockInput.type === BlockInputType.availableData || blockInput.type === BlockInputType.dataPromise) {
      const blockData =
        blockInput.type === BlockInputType.availableData
          ? blockInput.blockData
          : await blockInput.cachedData.availabilityPromise;

      // NOTE: Old data is pruned on archive
      if (isForkPostFulu(blockData.fork)) {
        const {custodyConfig} = this;
        const {custodyColumns} = custodyConfig;
        const blobsLen = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;
        let dataColumnsLen: number;
        if (blobsLen === 0) {
          dataColumnsLen = 0;
        } else {
          dataColumnsLen = custodyColumns.length;
        }

        const blockDataColumns = (blockData as BlockInputDataColumns).dataColumns;
        const dataColumnSidecars = blockDataColumns.filter((dataColumnSidecar) =>
          custodyColumns.includes(dataColumnSidecar.index)
        );
        if (dataColumnSidecars.length !== dataColumnsLen) {
          throw Error(
            `Invalid dataColumnSidecars=${dataColumnSidecars.length} for custody expected custodyColumnsLen=${dataColumnsLen}`
          );
        }

        fnPromises.push(this.db.dataColumnSidecar.putMany(blockRoot, dataColumnSidecars));
        this.logger.debug("Persisted dataColumnSidecars to hot DB", {
          dataColumnSidecars: dataColumnSidecars.length,
          slot: block.message.slot,
          root: blockRootHex,
        });
      } else if (isForkPostDeneb(blockData.fork)) {
        const blobSidecars = (blockData as BlockInputBlobs).blobs;
        fnPromises.push(this.db.blobSidecars.add({blockRoot, slot: block.message.slot, blobSidecars}));
        this.logger.debug("Persisted blobSidecars to hot DB", {
          blobsLen: blobSidecars.length,
          slot: block.message.slot,
          root: blockRootHex,
        });
      }
    }
  }

  await Promise.all(fnPromises);
  this.logger.debug("Persisted blocksInput to db", {
    blocksInput: blocksInput.length,
    slots: prettyPrintIndices(blocksInput.map((blockInput) => blockInput.block.message.slot)),
  });
}

/**
 * Prunes eagerly persisted block inputs only if not known to the fork-choice
 */
export async function removeEagerlyPersistedBlockInputs(this: BeaconChain, blockInputs: BlockInput[]): Promise<void> {
  const blockToRemove = [];
  const blobsToRemove = [];
  const dataColumnsToRemove = [];

  for (const blockInput of blockInputs) {
    const {block, type} = blockInput;
    const slot = block.message.slot;
    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toHex(blockRoot);
    if (!this.forkChoice.hasBlockHex(blockRootHex)) {
      blockToRemove.push(block);

      if (type === BlockInputType.availableData) {
        const {blockData} = blockInput;
        if (blockData.fork === ForkName.deneb || blockData.fork === ForkName.electra) {
          const blobSidecars = blockData.blobs;
          blobsToRemove.push({blockRoot, slot, blobSidecars});
        } else {
          const {custodyConfig} = this;
          const {custodyColumns} = custodyConfig;
          const dataColumnsLen = custodyColumns.length;
          const dataColumnSidecars = (blockData as BlockInputDataColumns).dataColumns.filter((dataColumnSidecar) =>
            custodyColumns.includes(dataColumnSidecar.index)
          );
          if (dataColumnSidecars.length !== dataColumnsLen) {
            throw Error(
              `Invalid dataColumnSidecars=${dataColumnSidecars.length} for custody expected custodyColumnsLen=${dataColumnsLen}`
            );
          }

          dataColumnsToRemove.push(blockRoot);
        }
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
