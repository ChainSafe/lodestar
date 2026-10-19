import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu} from "@lodestar/params";
import {DataColumnSidecar, SignedBeaconBlock, Slot, gloas, isGloasDataColumnSidecar, ssz} from "@lodestar/types";
import {Logger, fromHex, toHex, toRootHex} from "@lodestar/utils";
import {isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "../chain/blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../chain/emitter.js";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../chain/errors/envelopeReconstructionError.js";
import {IBeaconDb} from "../db/index.js";
import {ArchivedEnvelope, decodeArchivedEnvelope} from "../db/repositories/index.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {
  getCellsAndProofs,
  getDataColumnSidecarsFromBlock,
  getDataColumnSidecarsFromColumnSidecar,
  getGloasDataColumnSidecars,
} from "./dataColumns.js";
import {signedHeaderEnvelopeToFull} from "./headerEnvelope.js";

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

/** engine_getPayloadBodiesByHashV2: every EL must accept requests of up to 32 hashes, larger ones may fail with -38004 */
export const MAX_BODIES_PER_REQUEST = 32;

type SlotEnvelopeBytes = {slot: Slot; envelopeBytes: Uint8Array};

type RangeEntry = ArchivedEnvelope & {slot: Slot};

/** What an envelope that cannot be rebuilt (EL-unavailable body or body root mismatch) means on a given serving path */
export type ReconstructMissPolicy = "throw" | "omit";

/**
 * An archived envelope that could not be rebuilt. `"unavailable"`: the EL does not have the block or its
 * block access list (BODY_UNAVAILABLE). `"mismatch"`: an EL body does not hash to its stored root, a local
 * inconsistency (BODY_ROOT_MISMATCH). `error` carries the matching code for paths that surface it.
 */
export type RebuildMiss = {slot: Slot; reason: "unavailable" | "mismatch"; error: EnvelopeReconstructionError};

/**
 * Stream finalized envelopes over [startSlot, endSlot) as serialized bytes, rebuilding header
 * entries from EL bodies 32 per round-trip.
 *
 * Ends at the first entry that cannot be served by throwing RANGE_UNSERVABLE with that slot: the
 * by-range spec inherits BeaconBlocksByRange v2 semantics (consecutive, MAY be short), and a hole
 * looks like a lying peer to one that already holds the blocks. Entries are attempted regardless of
 * age; the EL's block access list retention is the floor, not MIN_EPOCHS_FOR_BLOCK_REQUESTS.
 *
 * Throws ENGINE_UNAVAILABLE if the EL call fails. Either may surface after envelopes were yielded.
 */
export async function* reconstructExecutionPayloadEnvelopesByRange(
  db: IBeaconDb,
  executionEngine: IExecutionEngine,
  logger: Logger,
  metrics: Metrics | null,
  startSlot: Slot,
  endSlot: Slot
): AsyncIterable<SlotEnvelopeBytes> {
  const archive = db.executionPayloadEnvelopeArchive;
  let batch: RangeEntry[] = [];

  for await (const {key, value: bytes} of archive.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
    batch.push({slot: archive.decodeKey(key), ...decodeArchivedEnvelope(bytes)});
    if (batch.length === MAX_BODIES_PER_REQUEST) {
      yield* reconstructBatch(executionEngine, logger, metrics, batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield* reconstructBatch(executionEngine, logger, metrics, batch);
  }
}

/**
 * Rebuild a range batch, yielding what precedes the first unservable entry before throwing
 * RANGE_UNSERVABLE for it
 */
async function* reconstructBatch(
  executionEngine: IExecutionEngine,
  logger: Logger,
  metrics: Metrics | null,
  batch: RangeEntry[]
): AsyncIterable<SlotEnvelopeBytes> {
  const headerEnvelopes: gloas.SignedExecutionPayloadHeaderEnvelope[] = [];
  for (const entry of batch) {
    if (entry.headerEnvelope !== undefined) headerEnvelopes.push(entry.headerEnvelope);
  }
  const rebuilt = await reconstructEnvelopesBatch(executionEngine, metrics, headerEnvelopes);

  let rebuiltIdx = 0;
  for (const entry of batch) {
    if (entry.envelopeBytes !== undefined) {
      yield {slot: entry.slot, envelopeBytes: entry.envelopeBytes};
      continue;
    }
    const result = rebuilt[rebuiltIdx++];
    if (isRebuildMiss(result)) {
      // Peer-triggered, so debug: a persistent local mismatch would otherwise log on every request
      if (result.reason === "mismatch") {
        logger.debug("Archived envelope failed body root check against EL bodies", {slot: entry.slot}, result.error);
      } else {
        logger.debug("EL cannot serve bodies for archived envelope, ending range", {slot: entry.slot});
      }
      throw new EnvelopeReconstructionError(
        {code: EnvelopeReconstructionErrorCode.RANGE_UNSERVABLE, slot: entry.slot},
        `archived envelope range unservable from slot=${entry.slot}`
      );
    }
    yield {slot: entry.slot, envelopeBytes: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(result)};
  }
}

/**
 * Rebuild header envelopes from EL bodies, 32 per round-trip. Aligned with the input, with a
 * {@link RebuildMiss} where the envelope could not be rebuilt; the caller decides what a miss means
 * on its path. Throws ENGINE_UNAVAILABLE only.
 */
export async function reconstructExecutionPayloadEnvelopes(
  executionEngine: IExecutionEngine,
  metrics: Metrics | null,
  headerEnvelopes: gloas.SignedExecutionPayloadHeaderEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[]> {
  const out: (gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[] = [];
  for (let i = 0; i < headerEnvelopes.length; i += MAX_BODIES_PER_REQUEST) {
    out.push(
      ...(await reconstructEnvelopesBatch(
        executionEngine,
        metrics,
        headerEnvelopes.slice(i, i + MAX_BODIES_PER_REQUEST)
      ))
    );
  }
  return out;
}

export function isRebuildMiss(result: gloas.SignedExecutionPayloadEnvelope | RebuildMiss): result is RebuildMiss {
  return "reason" in result;
}

/**
 * One EL round-trip. Aligned with the input; never throws per envelope, only ENGINE_UNAVAILABLE.
 * Every serving path (by-range, by-root, REST) comes through here, so the outcome metrics are
 * incremented once, in this function.
 */
async function reconstructEnvelopesBatch(
  executionEngine: IExecutionEngine,
  metrics: Metrics | null,
  headerEnvelopes: gloas.SignedExecutionPayloadHeaderEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[]> {
  if (headerEnvelopes.length === 0) return [];
  const hashes = headerEnvelopes.map((headerEnvelope) => toRootHex(headerEnvelope.message.payloadHeader.blockHash));

  let bodies: Awaited<ReturnType<IExecutionEngine["getPayloadBodiesByHashV2"]>>;
  try {
    bodies = await executionEngine.getPayloadBodiesByHashV2(hashes);
  } catch (e) {
    metrics?.payloadEnvelopeReconstruction.engineErrors.inc();
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE},
      `engine_getPayloadBodiesByHashV2 failed: ${(e as Error).message}`
    );
  }

  return headerEnvelopes.map((headerEnvelope, i) => {
    const slot = headerEnvelope.message.payloadHeader.slotNumber;
    const body = bodies[i];
    // A zero-length block access list cannot be valid, RLP encodes an empty list as 0xc0
    if (body == null || body.withdrawals == null || body.blockAccessList == null || body.blockAccessList.length === 0) {
      metrics?.payloadEnvelopeReconstruction.envelopes.inc({result: "unavailable"});
      return {
        slot,
        reason: "unavailable",
        error: new EnvelopeReconstructionError(
          {code: EnvelopeReconstructionErrorCode.BODY_UNAVAILABLE, slot},
          `execution client cannot serve the payload body or block access list for archived envelope slot=${slot}`
        ),
      };
    }
    try {
      const envelope = signedHeaderEnvelopeToFull(headerEnvelope, {
        transactions: body.transactions,
        withdrawals: body.withdrawals,
        blockAccessList: body.blockAccessList,
      });
      metrics?.payloadEnvelopeReconstruction.envelopes.inc({result: "success"});
      return envelope;
    } catch (e) {
      if (
        e instanceof EnvelopeReconstructionError &&
        e.type.code === EnvelopeReconstructionErrorCode.BODY_ROOT_MISMATCH
      ) {
        metrics?.payloadEnvelopeReconstruction.envelopes.inc({result: "mismatch"});
        metrics?.payloadEnvelopeReconstruction.mismatchByField.inc({field: e.type.field});
        return {slot, reason: "mismatch", error: e};
      }
      throw e;
    }
  });
}
