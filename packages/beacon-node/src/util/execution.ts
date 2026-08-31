import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu} from "@lodestar/params";
import {DataColumnSidecar, SignedBeaconBlock, isGloasDataColumnSidecar} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "../chain/blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../chain/emitter.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
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
  const blobs = await executionEngine.getBlobs(input.forkName as ForkPostFulu, versionedHashes, blobAndProofBuffers);
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

  // for columns we have already seen, publishDataColumnSidecar() catches PublishError.Duplicate and marks alreadyPublished=true
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
        kzgCommitments: !isGloasDataColumnSidecar(columnSidecar) ? columnSidecar.kzgCommitments.map(toHex) : undefined,
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
