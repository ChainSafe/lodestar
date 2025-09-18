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
import {deneb, fulu} from "@lodestar/types";
import {isBlockInputBlobs, isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {ForkPostFulu, ForkPreFulu} from "@lodestar/params";
import {computePreFuluKzgCommitmentsInclusionProof} from "./blobs.js";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {routes} from "@lodestar/api";
import {toHex} from "@lodestar/utils";

export async function getBlobSidecarsFromExecution(
  config: ChainForkConfig,
  executionEngine: IExecutionEngine,
  metrics: Metrics | null,
  emitter: ChainEventEmitter,
  blockInput: IBlockInput
) {
  if (!isBlockInputBlobs(blockInput)) {
    return;
  }

  if (blockInput.hasAllData()) {
    return;
  }

  const forkName = blockInput.forkName as ForkPreFulu;
  const blobMeta = blockInput.getMissingBlobMeta();

  metrics?.blobs.getBlobsV1Requests.inc();
  metrics?.blobs.getBlobsV1RequestedBlobCount.inc(blobMeta.length);
  const enginedResponse = await executionEngine
    .getBlobs(
      forkName,
      blobMeta.map(({versionedHash}) => versionedHash)
    )
    .catch((_e) => {
      // TODO(fulu): this should only count as a single error? need to update the promql to reflect this
      metrics?.blobs.getBlobsV1Error.inc(blobMeta.length);
      return null;
    });

  if (enginedResponse === null) {
    return;
  }

  const block = blockInput.getBlock();

  const blobSidecars: deneb.BlobSidecars = [];
  // response.length should always match blobMeta.length and they should be in the same order
  for (let i = 0; i < blobMeta.length; i++) {
    const blobAndProof = enginedResponse[i];

    if (!blobAndProof) {
      metrics?.blobs.getBlobsV1Miss.inc();
    } else {
      metrics?.blobs.getBlobsV1Hit.inc();

      if (blockInput.hasBlob(blobMeta[i].index)) {
        // blob arrived and was cached while waiting for API response
        metrics?.blobs.getBlobsV1HitButArrivedWhileWaiting.inc();
        continue;
      }

      metrics?.blobs.getBlobsV1HitUseful.inc();
      const {blob, proof} = blobAndProof;
      const index = blobMeta[i].index;
      const kzgCommitment = block.message.body.blobKzgCommitments[index];
      const blobSidecar: deneb.BlobSidecar = {
        index,
        blob,
        kzgProof: proof,
        kzgCommitment,
        // TODO(fulu): refactor this to only calculate the root inside these following two functions once
        kzgCommitmentInclusionProof: computePreFuluKzgCommitmentsInclusionProof(forkName, block.message.body, index),
        signedBlockHeader: signedBlockToSignedHeader(config, block),
      };

      blockInput.addBlob({
        blobSidecar,
        blockRootHex: blockInput.blockRootHex,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.engine,
      });

      if (emitter.listenerCount(routes.events.EventType.blobSidecar)) {
        emitter.emit(routes.events.EventType.blobSidecar, {
          blockRoot: blockInput.blockRootHex,
          slot: blockInput.slot,
          index,
          kzgCommitment: toHex(kzgCommitment),
          versionedHash: toHex(blobMeta[i].versionedHash),
        });
      }

      blobSidecars.push(blobSidecar);
    }
  }

  emitter.emit(ChainEvent.publishBlobSidecars, blobSidecars);
  metrics?.gossipBlob.publishedFromEngine.inc(blobSidecars.length);
}

/**
 * Post fulu, call getBlobsV2 from execution engine once per slot whenever we see either beacon_block or data_column_sidecar gossip message
 */
export async function getDataColumnSidecarsFromExecution(
  config: ChainForkConfig,
  executionEngine: IExecutionEngine,
  emitter: ChainEventEmitter,
  blockInput: IBlockInput,
  metrics: Metrics | null,
  blobAndProofBuffers?: Uint8Array[]
): Promise<void> {
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
}
