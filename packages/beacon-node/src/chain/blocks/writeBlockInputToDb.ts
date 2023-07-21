import {allForks, deneb} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
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
    const {block, blockBytes, type} = blockInput;
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

    if (type === BlockInputType.postDeneb) {
      const {blobs} = blockInput;
      // NOTE: Old blobs are pruned on archive
      fnPromises.push(this.db.blobsSidecar.add(blobs));
      this.logger.debug("Persist blobsSidecar to hot DB", {
        blobsLen: blobs.blobs.length,
        slot: blobs.beaconBlockSlot,
        root: toHex(blobs.beaconBlockRoot),
      });
    }
  }

  await Promise.all(fnPromises);
}

/**
 * Prunes eagerly persisted block inputs only if not known to the fork-choice
 */
export async function removeEagerlyPersistedBlockInputs(this: BeaconChain, blockInputs: BlockInput[]): Promise<void> {
  const blockToRemove: allForks.SignedBeaconBlock[] = [];
  const blobsToRemove: deneb.BlobsSidecar[] = [];

  for (const blockInput of blockInputs) {
    const {block, type} = blockInput;
    const blockRoot = toHex(this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
    if (!this.forkChoice.hasBlockHex(blockRoot)) {
      blockToRemove.push(block);

      if (type === BlockInputType.postDeneb) {
        blobsToRemove.push(blockInput.blobs);
        this.db.blobsSidecar.remove(blockInput.blobs).catch((e) => {
          this.logger.verbose("Error removing eagerly imported blobsSidecar", {blockRoot}, e);
        });
      }
    }
  }

  await Promise.all([
    // TODO: Batch DB operations not with Promise.all but with level db ops
    this.db.block.batchRemove(blockToRemove),
    this.db.blobsSidecar.batchRemove(blobsToRemove),
  ]);
}
