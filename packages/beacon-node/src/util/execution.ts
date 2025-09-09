import {ChainForkConfig} from "@lodestar/config";
import {
  getCellsAndProofs,
  getDataColumnSidecarsFromBlock,
  getDataColumnSidecarsFromColumnSidecar,
} from "./dataColumns.js";
import {IExecutionEngine} from "../execution/index.js";
import {ChainEvent, ChainEventEmitter} from "../chain/emitter.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {Metrics} from "../metrics/index.js";
import {fulu} from "@lodestar/types";
import {isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {ForkPostFulu} from "@lodestar/params";
import {BLOB_AND_PROOF_V2_RPC_BYTES} from "../execution/engine/types.js";

let running = false;
// Preallocate buffers for getBlobsV2 RPC calls
// See https://github.com/ChainSafe/lodestar/pull/8282 for context
const blobAndProofBuffers: Uint8Array[] = [];

/**
 * Post fulu, call getBlobsV2 from execution engine once per slot whenever we see either beacon_block or data_column_sidecar gossip message
 * Only a single call can be in-flight at a time, subsequent calls are ignored
 */
export async function getDataColumnSidecarsFromExecution(
  config: ChainForkConfig,
  executionEngine: IExecutionEngine,
  emitter: ChainEventEmitter,
  blockInput: IBlockInput,
  metrics: Metrics | null
): Promise<void> {
  try {
    if (running) {
      return;
    }
    running = true;

    // If its not a column block input, exit
    if (!isBlockInputColumns(blockInput)) {
      return;
    }

    // If already have all columns, exit
    if (blockInput.hasAllData()) {
      return;
    }

    const versionedHashes = blockInput.getVersionedHashes();

    // If there are no blobs in this block, exit
    if (versionedHashes.length === 0) {
      return;
    }

    // Get blobs from execution engine
    metrics?.peerDas.getBlobsV2Requests.inc();
    const timer = metrics?.peerDas.getBlobsV2RequestDuration.startTimer();
    if (blobAndProofBuffers) {
      for (let i = 0; i < versionedHashes.length; i++) {
        if (blobAndProofBuffers[i] === undefined) {
          blobAndProofBuffers[i] = new Uint8Array(BLOB_AND_PROOF_V2_RPC_BYTES);
        }
      }
    }
    const blobs = await executionEngine.getBlobs(
      blockInput.forkName as ForkPostFulu,
      versionedHashes,
      blobAndProofBuffers
    );
    timer?.();

    // Execution engine was unable to find one or more blobs
    if (blobs === null) {
      return;
    }
    metrics?.peerDas.getBlobsV2Responses.inc();

    // Return if we received all data columns while waiting for getBlobs
    if (blockInput.hasAllData()) {
      return;
    }

    let dataColumnSidecars: fulu.DataColumnSidecars;
    const cellsAndProofs = await getCellsAndProofs(blobs);
    if (blockInput.hasBlock()) {
      dataColumnSidecars = getDataColumnSidecarsFromBlock(
        config,
        blockInput.getBlock() as fulu.SignedBeaconBlock,
        cellsAndProofs
      );
    } else {
      const firstSidecar = blockInput.getAllColumns()[0];
      dataColumnSidecars = getDataColumnSidecarsFromColumnSidecar(firstSidecar, cellsAndProofs);
    }

    // Publish columns if and only if subscribed to them
    const previouslyMissingColumns = blockInput.getMissingSampledColumnMeta().missing;
    const sampledColumns = previouslyMissingColumns.map((columnIndex) => dataColumnSidecars[columnIndex]);

    // for columns that we already seen, it will be ignored through `ignoreDuplicatePublishError` gossip option
    emitter.emit(ChainEvent.publishDataColumns, sampledColumns);

    // add all sampled columns to the block input, even if we didn't sample them
    const seenTimestampSec = Date.now() / 1000;
    for (const columnSidecar of sampledColumns) {
      blockInput.addColumn(
        {columnSidecar, blockRootHex: blockInput.blockRootHex, source: BlockInputSource.engine, seenTimestampSec},
        {throwOnDuplicateAdd: false} // columns may have been added while waiting
      );
    }

    metrics?.dataColumns.bySource.inc({source: BlockInputSource.engine}, previouslyMissingColumns.length);
  } finally {
    running = false;
  }
}
