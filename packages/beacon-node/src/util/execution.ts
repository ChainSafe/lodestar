import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu, ForkPreFulu} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {DataColumnSidecar, SignedBeaconBlock, Slot, deneb, gloas, isGloasDataColumnSidecar, ssz} from "@lodestar/types";
import {Logger, fromHex, toHex, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "../chain/blocks/payloadEnvelopeInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../chain/emitter.js";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../chain/errors/envelopeReconstructionError.js";
import {IBeaconDb} from "../db/index.js";
import {ArchivedEnvelopeEntry, ArchivedEnvelopeKind, decodeArchivedEnvelope} from "../db/repositories/index.js";
import {IExecutionEngine} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {signedBlindedEnvelopeToFull} from "./blindedEnvelope.js";
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

// Execution payload envelopes: rebuild blinded archive entries from EL bodies

/** engine_getPayloadBodiesByHashV2: ELs MUST support at least 32 hashes per request. */
const MAX_BODIES_REQUEST = 32;

type SlotEnvelopeBytes = {slot: Slot; envelopeBytes: Uint8Array};

type RangeEntry = ArchivedEnvelopeEntry & {slot: Slot};

/** What a body root mismatch means on a given serving path */
export type ReconstructMismatchPolicy = "throw" | "omit";

export type RebuildMiss =
  /** EL does not have the block, or has pruned its block access list */
  | {slot: Slot; reason: "unavailable"}
  /** An EL body does not hash to its stored root (local inconsistency) */
  | {slot: Slot; reason: "mismatch"; error: EnvelopeReconstructionError};

/**
 * Stream finalized envelopes over [startSlot, endSlot) as serialized bytes, rebuilding blinded
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
    if (batch.length === MAX_BODIES_REQUEST) {
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
  const blindedEnvelopes: gloas.SignedBlindedExecutionPayloadEnvelope[] = [];
  for (const entry of batch) {
    if (entry.selector === ArchivedEnvelopeKind.Blinded) blindedEnvelopes.push(entry.value);
  }
  const rebuilt = await reconstructEnvelopesBatch(executionEngine, metrics, blindedEnvelopes);

  let blindedIdx = 0;
  for (const entry of batch) {
    if (entry.selector === ArchivedEnvelopeKind.Full) {
      yield {slot: entry.slot, envelopeBytes: entry.envelopeBytes};
      continue;
    }
    const result = rebuilt[blindedIdx++];
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
 * Rebuild blinded envelopes from EL bodies, 32 per round-trip. Aligned with the input, with a
 * {@link RebuildMiss} where the envelope could not be rebuilt; the caller decides what a miss means
 * on its path. Throws ENGINE_UNAVAILABLE only.
 */
export async function reconstructExecutionPayloadEnvelopes(
  executionEngine: IExecutionEngine,
  metrics: Metrics | null,
  blindedEnvelopes: gloas.SignedBlindedExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[]> {
  const out: (gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[] = [];
  for (let i = 0; i < blindedEnvelopes.length; i += MAX_BODIES_REQUEST) {
    out.push(
      ...(await reconstructEnvelopesBatch(executionEngine, metrics, blindedEnvelopes.slice(i, i + MAX_BODIES_REQUEST)))
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
  blindedEnvelopes: gloas.SignedBlindedExecutionPayloadEnvelope[]
): Promise<(gloas.SignedExecutionPayloadEnvelope | RebuildMiss)[]> {
  if (blindedEnvelopes.length === 0) return [];
  const hashes = blindedEnvelopes.map((blindedEnvelope) => toRootHex(blindedEnvelope.message.payload.blockHash));

  let bodies: Awaited<ReturnType<IExecutionEngine["getPayloadBodiesByHashV2"]>>;
  try {
    bodies = await executionEngine.getPayloadBodiesByHashV2(hashes);
  } catch (e) {
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE},
      `engine_getPayloadBodiesByHashV2 failed: ${(e as Error).message}`
    );
  }

  return blindedEnvelopes.map((blindedEnvelope, i) => {
    const slot = blindedEnvelope.message.payload.slotNumber;
    const body = bodies[i];
    // A zero-length block access list cannot be valid, RLP encodes an empty list as 0xc0
    if (body == null || body.withdrawals == null || body.blockAccessList == null || body.blockAccessList.length === 0) {
      metrics?.payloadEnvelopeReconstruction.envelopes.inc({result: "unavailable"});
      return {slot, reason: "unavailable"};
    }
    try {
      const envelope = signedBlindedEnvelopeToFull(blindedEnvelope, {
        transactions: body.transactions,
        withdrawals: body.withdrawals,
        blockAccessList: body.blockAccessList,
      });
      metrics?.payloadEnvelopeReconstruction.envelopes.inc({result: "ok"});
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
