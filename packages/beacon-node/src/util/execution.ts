import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu, ForkPreFulu} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {DataColumnSidecar, SignedBeaconBlock, deneb, isGloasDataColumnSidecar} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "../chain/blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../chain/emitter.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {computePreFuluKzgCommitmentsInclusionProof} from "./blobs.js";
import {
  getCellsAndProofs,
  getDataColumnSidecarsFromBlock,
  getDataColumnSidecarsFromColumnSidecar,
  getGloasDataColumnSidecars,
} from "./dataColumns.js";

export enum DataColumnEngineResult {
  PreFulu = "pre_fulu",
  // the recover is not attempted because it has full data columns
  NotAttemptedFull = "not_attempted_full",
  // block has no blob so no need to call EL
  NotAttemptedNoBlobs = "not_attempted_no_blobs",
  // EL call returned null, meaning it could not find the blobs
  NullResponse = "null_response",
  // the recover is a success and it helps resolve availability
  SuccessResolved = "success_resolved",
  // the recover is a success but it's late, availability is already resolved by either gossip or getBlobsV2
  SuccessLate = "success_late",
  Failed = "failed",
}

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
 * Call getBlobsV2 from execution engine once per slot to fetch blobs and compute data columns.
 *
 * Post fulu, whenever we see either beacon_block or data_column_sidecar gossip message and data isn't complete.
 * Post gloas, immediately when beacon block is successfully imported and PayloadEnvelopeInput is created.
 */
export async function getDataColumnSidecarsFromExecution(
  config: ChainForkConfig,
  executionEngine: IExecutionEngine,
  emitter: ChainEventEmitter,
  input: IBlockInput | PayloadEnvelopeInput,
  metrics: Metrics | null,
  blobAndProofBuffers?: Uint8Array[]
): Promise<DataColumnEngineResult> {
  const isPayloadInput = input instanceof PayloadEnvelopeInput;

  // Pre gloas, ensure it's a column block input
  if (!isPayloadInput && !isBlockInputColumns(input)) {
    return DataColumnEngineResult.PreFulu;
  }

  // If already have all columns, exit
  if (input.hasAllData()) {
    return DataColumnEngineResult.NotAttemptedFull;
  }

  const versionedHashes = input.getVersionedHashes();

  // If there are no blobs in this block, exit
  if (versionedHashes.length === 0) {
    return DataColumnEngineResult.NotAttemptedNoBlobs;
  }

  // Get blobs from execution engine
  metrics?.peerDas.getBlobsV2Requests.inc();
  const timer = metrics?.peerDas.getBlobsV2RequestDuration.startTimer();
  const forkName = input.forkName as ForkPostFulu;
  const blobs = await executionEngine.getBlobs(forkName, versionedHashes, blobAndProofBuffers);
  timer?.();

  // Execution engine was unable to find one or more blobs
  if (blobs === null) {
    return DataColumnEngineResult.NullResponse;
  }
  metrics?.peerDas.getBlobsV2Responses.inc();

  // Return if we received all data columns while waiting for getBlobs
  if (input.hasAllData()) {
    return DataColumnEngineResult.SuccessLate;
  }

  let dataColumnSidecars: DataColumnSidecar[];
  const compTimer = metrics?.peerDas.dataColumnSidecarComputationTime.startTimer();
  try {
    const cellsAndProofs = await getCellsAndProofs(blobs);
    if (isPayloadInput) {
      dataColumnSidecars = getGloasDataColumnSidecars(input.slot, fromHex(input.blockRootHex), cellsAndProofs);
    } else if (input.hasBlock()) {
      dataColumnSidecars = getDataColumnSidecarsFromBlock(
        config,
        input.getBlock() as SignedBeaconBlock<ForkPostFulu>,
        cellsAndProofs
      );
    } else {
      const firstSidecar = input.getAllColumns()[0];
      dataColumnSidecars = getDataColumnSidecarsFromColumnSidecar(firstSidecar, cellsAndProofs);
    }
  } finally {
    compTimer?.();
  }

  // Publish columns if and only if subscribed to them
  const previouslyMissingColumns = input.getMissingSampledColumnMeta().missing;
  const sampledColumns = previouslyMissingColumns.map((columnIndex) => dataColumnSidecars[columnIndex]);

  // for columns that we already seen, it will be ignored through `ignoreDuplicatePublishError` gossip option
  emitter.emit(ChainEvent.publishDataColumns, sampledColumns);
  // TODO: Can we record dataColumns.sentPeersPerSubnet metric here somehow

  // add all sampled columns to the input, even if we didn't sample them
  const seenTimestampSec = Date.now() / 1000;
  let alreadyAddedColumnsCount = 0;
  for (const columnSidecar of sampledColumns) {
    if (input.hasColumn(columnSidecar.index)) {
      // columns may have been added while waiting
      alreadyAddedColumnsCount++;
      continue;
    }

    if (isPayloadInput) {
      if (!isGloasDataColumnSidecar(columnSidecar)) {
        throw new Error(`Expected gloas DataColumnSidecar for block ${input.blockRootHex}`);
      }
      input.addColumn({
        columnSidecar,
        source: PayloadEnvelopeInputSource.engine,
        seenTimestampSec,
      });
    } else {
      if (isGloasDataColumnSidecar(columnSidecar)) {
        throw new Error(`Expected fulu DataColumnSidecar for block ${input.blockRootHex}`);
      }
      input.addColumn({
        columnSidecar,
        blockRootHex: input.blockRootHex,
        source: BlockInputSource.engine,
        seenTimestampSec,
      });
    }

    if (emitter.listenerCount(routes.events.EventType.dataColumnSidecar)) {
      emitter.emit(routes.events.EventType.dataColumnSidecar, {
        blockRoot: input.blockRootHex,
        slot: input.slot,
        index: columnSidecar.index,
        kzgCommitments: isGloasDataColumnSidecar(columnSidecar) ? undefined : columnSidecar.kzgCommitments.map(toHex),
      });
    }
  }
  metrics?.dataColumns.alreadyAdded.inc(alreadyAddedColumnsCount);

  metrics?.dataColumns.bySource.inc(
    {source: BlockInputSource.engine},
    previouslyMissingColumns.length - alreadyAddedColumnsCount
  );
  return DataColumnEngineResult.SuccessResolved;
}
