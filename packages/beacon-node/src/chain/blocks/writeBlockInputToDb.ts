import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {fulu, SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {toHex} from "@lodestar/utils";
import {BeaconChain} from "../chain.js";
import {BlockInput, isBlockInputBlobs, isBlockInputColumns} from "./utils/blockInput.js";
import {BlobSidecarsWrapper} from "../../db/repositories/blobSidecars.js";
import {DataColumnSidecarsWrapper} from "../../db/repositories/dataColumnSidecars.js";

function calculateDataColumnsSize(columnLength: number): number {
  return (
    ssz.fulu.DataColumnSidecar.minSize +
    columnLength * (ssz.fulu.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize)
  );
}
/**
 * Persists block input data to DB. This operation must be eventually completed if a block is imported to the fork-choice.
 * Else the node will be in an inconsistent state that can lead to being stuck.
 *
 * This operation may be performed before, during or after importing to the fork-choice. As long as errors
 * are handled properly for eventual consistency.
 */
export async function writeBlockInputToDb(this: BeaconChain, blocksInputs: BlockInput[]): Promise<void> {
  const fnPromises: Promise<void>[] = [];

  for (const blockInput of blocksInputs) {
    const block = blockInput.getBlock();
    const slot = blockInput.getSlot();
    const {blockRoot, rootHex} = blockInput;
    fnPromises.push(this.db.block.add(block));
    this.logger.debug("Persist block to hot DB", {
      slot,
      root: rootHex,
    });

    // TODO: this conditions should not ever be hit. double check all callers to write to db
    if (blockInput.needData()) {
      await blockInput.waitForData();
    }

    // NOTE: Old data is pruned on archive
    if (isBlockInputBlobs(blockInput)) {
      const blobSidecars = blockInput.getBlobs();
      fnPromises.push(
        this.db.blobSidecars.add({blockRoot, slot: block.message.slot, blobSidecars}).then(() =>
          this.logger.debug("Persisted blobSidecars to hot DB", {
            blobsLen: blobSidecars.length,
            slot: block.message.slot,
            root: rootHex,
          })
        )
      );
    } else if (isBlockInputColumns(blockInput)) {
      const columnSidecars = blockInput.getCustodyColumns();
      const dataColumnIndex = blockInput.getCustodyIndex();
      const columnLength = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;
      const dataColumnsSize = calculateDataColumnsSize(columnLength);
      // TODO: (@matthewkeil) this is calculated differently in removal below. Rectify with @g11tech
      // const dataColumnsSize =
      //   ssz.fulu.DataColumnSidecar.minSize +
      //   columnLength * (ssz.fulu.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);
      fnPromises.push(
        this.db.dataColumnSidecars
          .add({
            blockRoot,
            slot,
            dataColumnsLen: columnSidecars.length,
            dataColumnsSize,
            dataColumnIndex,
            columnSidecars,
          })
          .then(() =>
            this.logger.debug("Persisted dataColumnSidecars to hot DB", {
              slot,
              rootHex,
              numberOfColumns: columnSidecars.length,
              dataColumnsSize,
            })
          )
      );
    }
  }

  await Promise.all(fnPromises);
  this.logger.debug("Persisted blocksInputs to db", {
    slots: blocksInputs.map((blockInput) => `[ ${blockInput.getSlot().join(", ")} ]`),
    numberOfBlocksInputs: blocksInputs.length,
  });
}

/**
 * Prunes eagerly persisted block inputs only if not known to the fork-choice
 */
export async function removeEagerlyPersistedBlockInputs(this: BeaconChain, blockInputs: BlockInput[]): Promise<void> {
  const blockToRemove: SignedBeaconBlock[] = [];
  const blobsToRemove: BlobSidecarsWrapper[] = [];
  const dataColumnsToRemove: DataColumnSidecarsWrapper[] = [];

  for (const blockInput of blockInputs) {
    const block = blockInput.getBlock();
    const slot = blockInput.getSlot();
    const {blockRoot, rootHex} = blockInput;
    if (!this.forkChoice.hasBlockHex(rootHex)) {
      blockToRemove.push(block);

      if (isBlockInputBlobs(blockInput)) {
        blobsToRemove.push({blockRoot, slot, blobSidecars: blockInput.getBlobs()});
      } else if (isBlockInputColumns(blockInput)) {
        const dataColumnSidecars = blockInput.getCustodyColumns();
        const dataColumnsIndex = blockInput.getCustodyIndex();
        const columnLength = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;
        const dataColumnsSize = calculateDataColumnsSize(columnLength);
        // TODO: (@matthewkeil) this is calculated differently in insertion above. Rectify with @g11tech
        // const blobsLen = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;
        // const dataColumnsSize = ssz.fulu.Cell.fixedSize * blobsLen;
        dataColumnsToRemove.push({
          blockRoot,
          slot,
          dataColumnsLen: dataColumnSidecars.length,
          dataColumnsSize,
          dataColumnsIndex,
          dataColumnSidecars,
        });
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
