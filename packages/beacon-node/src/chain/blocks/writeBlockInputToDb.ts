import {KeyValue} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {SignedBeaconBlock, fulu, ssz} from "@lodestar/types";
import {prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {toHex} from "@lodestar/utils";
import {BlobSidecarsWrapper} from "../../db/repositories/blobSidecars.js";
import {DataColumnSidecarsWrapper} from "../../db/repositories/dataColumnSidecars.js";
import {BeaconChain} from "../chain.js";
import {IBlockInput, isBlockInputBlobs, isBlockInputColumns} from "./blockInput/index.js";

/**
 * Persists block input data to DB. This operation must be eventually completed if a block is imported to the fork-choice.
 * Else the node will be in an inconsistent state that can lead to being stuck.
 *
 * This operation may be performed before, during or after importing to the fork-choice. As long as errors
 * are handled properly for eventual consistency.
 */
export async function writeBlockInputToDb(this: BeaconChain, blocksInputs: IBlockInput[]): Promise<void> {
  // track all these objects for a few batch db operations
  const putBlocks: KeyValue<Uint8Array, SignedBeaconBlock>[] = [];
  const putSerializedBlocks: KeyValue<Uint8Array, Uint8Array>[] = [];
  const putBlobSidecars: KeyValue<Uint8Array, BlobSidecarsWrapper>[] = [];
  const putDataColumnSidecars: KeyValue<Uint8Array, DataColumnSidecarsWrapper>[] = [];
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
      putSerializedBlocks.push({key: this.db.block.getId(block), value: blockBytes});
    } else {
      this.metrics?.importBlock.persistBlockNoSerializedDataCount.inc();
      putBlocks.push({key: this.db.block.getId(block), value: block});
    }

    this.logger.debug("Persist block to hot DB", {
      slot,
      root: blockRootHex,
      inputType: blockInput.type,
    });

    // NOTE: Old data is pruned on archive
    if (isBlockInputColumns(blockInput)) {
      const {custodyConfig} = this;
      const {custodyColumnsIndex, custodyColumns} = custodyConfig;
      const blobsLen = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;
      let dataColumnsLen: number;
      let dataColumnsIndex: Uint8Array;
      if (blobsLen === 0) {
        dataColumnsLen = 0;
        dataColumnsIndex = new Uint8Array(NUMBER_OF_COLUMNS);
      } else {
        dataColumnsLen = custodyColumns.length;
        dataColumnsIndex = custodyColumnsIndex;
      }

      const dataColumnSidecars = blockInput.getCustodyColumns();
      if (dataColumnSidecars.length !== dataColumnsLen) {
        throw Error(
          `Invalid dataColumnSidecars=${dataColumnSidecars.length} for custody expected custodyColumnsLen=${dataColumnsLen}`
        );
      }

      const dataColumnsSize =
        ssz.fulu.DataColumnSidecar.minSize +
        blobsLen * (ssz.fulu.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);
      const writeData = {
        blockRoot,
        slot,
        dataColumnsLen,
        dataColumnsSize,
        dataColumnsIndex,
        dataColumnSidecars,
      };
      putDataColumnSidecars.push({key: this.db.dataColumnSidecars.getId(writeData), value: writeData});

      this.logger.debug("Persisted dataColumnSidecars to hot DB", {
        dataColumnsSize,
        dataColumnsLen,
        dataColumnSidecars: dataColumnSidecars.length,
        slot,
        root: blockRootHex,
      });
    } else if (isBlockInputBlobs(blockInput)) {
      const blobSidecars = blockInput.getBlobs();
      const wrapper = {blockRoot, slot, blobSidecars};
      putBlobSidecars.push({key: this.db.blobSidecars.getId(wrapper), value: wrapper});
      this.logger.debug("Persisted blobSidecars to hot DB", {
        blobsLen: blobSidecars.length,
        slot,
        root: blockRootHex,
      });
    }
  }

  await Promise.all([
    this.db.block.batchPut(putBlocks),
    this.db.block.batchPutBinary(putSerializedBlocks),
    this.db.blobSidecars.batchPut(putBlobSidecars),
    this.db.dataColumnSidecars.batchPut(putDataColumnSidecars),
  ]);
  this.logger.debug("Persisted blocksInput to db", {
    blocksInput: blocksInputs.length,
    slots: prettyPrintIndices(slots),
  });
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
    const blockRootHex = toHex(blockRoot);
    if (!this.forkChoice.hasBlockHex(blockRootHex)) {
      blockToRemove.push(block);

      if (isBlockInputColumns(blockInput)) {
        const {custodyConfig} = this;
        const {custodyColumnsIndex: dataColumnsIndex, custodyColumns} = custodyConfig;
        const dataColumnsLen = custodyColumns.length;
        const dataColumnSidecars = blockInput.getCustodyColumns();
        if (dataColumnSidecars.length !== dataColumnsLen) {
          throw Error(
            `Invalid dataColumnSidecars=${dataColumnSidecars.length} for custody expected custodyColumnsLen=${dataColumnsLen}`
          );
        }

        const blobsLen = (block.message as fulu.BeaconBlock).body.blobKzgCommitments.length;
        const dataColumnsSize = ssz.fulu.Cell.fixedSize * blobsLen;

        dataColumnsToRemove.push({
          blockRoot,
          slot,
          dataColumnsLen,
          dataColumnsSize,
          dataColumnsIndex,
          dataColumnSidecars,
        });
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
    this.db.dataColumnSidecars.batchRemove(dataColumnsToRemove),
  ]);
}
