import {ForkName} from "@lodestar/params";
import {toHex} from "@lodestar/utils";
import {peerdas, ssz} from "@lodestar/types";
import {BeaconChain} from "../chain.js";
import {BlockInput, BlockInputType} from "./types.js";

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
    const {block, blockBytes} = blockInput;
    const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toHex(blockRoot);
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
    });

    if (blockInput.type === BlockInputType.availableData || blockInput.type === BlockInputType.dataPromise) {
      const blockData =
        blockInput.type === BlockInputType.availableData
          ? blockInput.blockData
          : await blockInput.cachedData.availabilityPromise;

      // NOTE: Old data is pruned on archive
      if (blockData.fork === ForkName.deneb) {
        const blobSidecars = blockData.blobs;
        fnPromises.push(this.db.blobSidecars.add({blockRoot, slot: block.message.slot, blobSidecars}));
        this.logger.debug("Persisted blobSidecars to hot DB", {
          blobsLen: blobSidecars.length,
          slot: block.message.slot,
          root: blockRootHex,
        });
      } else {
        const {dataColumnsLen, dataColumnsIndex, dataColumns: dataColumnSidecars} = blockData;
        const blobsLen = (block.message as peerdas.BeaconBlock).body.blobKzgCommitments.length;

        const dataColumnsSize =
          ssz.peerdas.DataColumnSidecar.minSize +
          blobsLen * (ssz.peerdas.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);
        const slot = block.message.slot;
        const writeData = {
          blockRoot,
          slot,
          dataColumnsLen,
          dataColumnsSize,
          dataColumnsIndex,
          dataColumnSidecars,
        };
        fnPromises.push(this.db.dataColumnSidecars.add(writeData));

        this.logger.debug("Persisted dataColumnSidecars to hot DB", {
          dataColumnsSize,
          dataColumnsLen,
          dataColumnSidecars: dataColumnSidecars.length,
          slot: block.message.slot,
          root: blockRootHex,
        });
      }
    }
  }

  await Promise.all(fnPromises);
  this.logger.debug("Persisted blocksInput to db", {
    blocksInput: blocksInput.length,
    slots: blocksInput.map((blockInput) => blockInput.block.message.slot).join(","),
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
        if (blockData.fork === ForkName.deneb) {
          const blobSidecars = blockData.blobs;
          blobsToRemove.push({blockRoot, slot, blobSidecars});
        } else {
          const {dataColumnsLen, dataColumnsIndex, dataColumns: dataColumnSidecars} = blockData;
          const blobsLen = (block.message as peerdas.BeaconBlock).body.blobKzgCommitments.length;
          const dataColumnsSize = ssz.peerdas.Cell.fixedSize * blobsLen;

          dataColumnsToRemove.push({
            blockRoot,
            slot,
            dataColumnsLen,
            dataColumnsSize,
            dataColumnsIndex,
            dataColumnSidecars,
          });
        }
      }
    }
  }

  await Promise.all([
    // TODO: Batch DB operations not with Promise.all but with level db ops
    this.db.block.batchRemove(blockToRemove),
    this.db.blobSidecars.batchRemove(blobsToRemove),
    this.db.dataColumnSidecars.batchRemove(dataColumnsToRemove),
  ]);
}
