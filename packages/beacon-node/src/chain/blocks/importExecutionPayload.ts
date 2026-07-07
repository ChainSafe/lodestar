import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadExecutionStatus} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex, isErrorAborted} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {PayloadError, PayloadErrorCode} from "./payloadError.js";
import {ImportPayloadOpts} from "./types.js";
import {verifyPayloadsDataAvailability} from "./verifyPayloadsDataAvailability.js";

const EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS = 64;

function toForkChoiceExecutionStatus(status: ExecutionPayloadStatus): PayloadExecutionStatus {
  switch (status) {
    case ExecutionPayloadStatus.VALID:
      return ExecutionStatus.Valid;
    case ExecutionPayloadStatus.SYNCING:
    case ExecutionPayloadStatus.ACCEPTED:
      return ExecutionStatus.Syncing;
    default:
      throw new Error(`Unexpected execution payload status for fork choice: ${status}`);
  }
}

/**
 * Import an execution payload envelope after all data is available.
 *
 * The envelope is only verified here, no state mutation. State effects from the payload
 * are applied on the next block via processParentExecutionPayload.
 *
 * The DA wait must have run upstream (range sync awaits DA in `verifyBlocksInEpoch` for the
 * whole segment; gossip / API path uses the `processExecutionPayload` wrapper below).
 *
 * The consensus body (fork-choice reads/writes, regen state, BLS signature) lives in the engine
 * (`verifyExecutionPayloadEnvelope` + `importExecutionPayload`). The facade keeps the EL calls
 * (facade-owned execution engine), the hot-DB write queue, metrics, and event emission.
 *
 * Steps:
 * 1. Emit `execution_payload_available` event for payload attestation
 * 2. Verify the envelope (engine: fork choice + regen state + fields + BLS) in parallel with the EL
 * 3. Handle the EL response
 * 4. Persist verified payload envelope to hot DB (waits for write-queue space for backpressure)
 * 5. Import to fork choice + FCU decision (engine); fire notifyForkchoiceUpdate (facade)
 * 6. Record metrics for payload envelope and column sources
 * 7. Emit `execution_payload` event
 */
export async function importExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const signedEnvelope = payloadInput.getPayloadEnvelope();
  const envelope = signedEnvelope.message;
  const slot = envelope.payload.slotNumber;
  const blockRootHex = payloadInput.blockRootHex;
  const blockHashHex = payloadInput.getBlockHashHex();
  const fork = this.config.getForkName(slot);

  // 1. Emit `execution_payload_available` event at the start of import. At this point the
  // payload input is already complete, so the payload and required data are available for
  // payload attestation. This event only signals availability (not validity), so we can emit
  // it before getting a response from the EL on whether the payload is valid or not.
  if (this.clock.currentSlot - slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayloadAvailable, {
      slot,
      blockRoot: blockRootHex,
    });
  }

  // Per-envelope SSZ bytes for the engine's bytes-first contract (unused by the JS engine). Gossip
  // populates serializedCache; fall back to serializing on a cache miss so all call sites pass real bytes.
  const envelopeBytes =
    this.serializedCache.get(signedEnvelope) ?? ssz.gloas.SignedExecutionPayloadEnvelope.serialize(signedEnvelope);

  // 2. Verify the envelope (engine: fork choice lookup + regen state + fields + BLS signature) in
  // parallel with the EL `notifyNewPayload` (facade-owned). Mirrors the block pipeline's state/sig ∥ EL
  // split — the EL result is needed to map the fork-choice execution status below.
  const [execResult] = await Promise.all([
    this.executionEngine.notifyNewPayload(
      fork,
      envelope.payload,
      payloadInput.getVersionedHashes(),
      envelope.parentBeaconBlockRoot,
      envelope.executionRequests
    ),
    this.beaconEngine.verifyExecutionPayloadEnvelope(envelopeBytes, signedEnvelope, payloadInput.proposerIndex, {
      validSignature: opts.validSignature === true,
    }),
  ]);

  // 3. Handle EL response (the EL is facade-owned; the engine only consumes the mapped status below).
  switch (execResult.status) {
    case ExecutionPayloadStatus.VALID:
      break;

    case ExecutionPayloadStatus.INVALID:
      throw new PayloadError({
        code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
        execStatus: execResult.status,
        errorMessage: execResult.validationError ?? "",
      });

    case ExecutionPayloadStatus.ACCEPTED:
    case ExecutionPayloadStatus.SYNCING:
      break;

    case ExecutionPayloadStatus.INVALID_BLOCK_HASH:
    case ExecutionPayloadStatus.ELERROR:
    case ExecutionPayloadStatus.UNAVAILABLE:
      throw new PayloadError({
        code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
        execStatus: execResult.status,
        errorMessage: execResult.validationError ?? "",
      });
  }

  // 4. Persist payload envelope to hot DB. Wait for write-queue space here to apply backpressure
  // on the import pipeline during sync, then perform the write asynchronously to avoid blocking.
  await this.unfinalizedPayloadEnvelopeWrites.waitForSpace();
  this.unfinalizedPayloadEnvelopeWrites.push(payloadInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error(
        "Error pushing payload envelope to unfinalized write queue",
        {slot, blockRoot: blockRootHex},
        e as Error
      );
    }
  });

  // 5. Import to fork choice (engine transitions the block's PENDING variant to FULL) and get the FCU
  // decision. The facade fires notifyForkchoiceUpdate on the EL from the returned data; the engine
  // never touches the EL. `disableImportExecutionFcU` stays a facade-side gate.
  const execStatus = toForkChoiceExecutionStatus(execResult.status);
  const {fcuUpdate, executionOptimistic} = this.beaconEngine.importExecutionPayload(
    fromHex(blockRootHex),
    blockHashHex,
    envelope.payload.blockNumber,
    envelope.payload.gasLimit,
    execStatus,
    dataAvailabilityStatus
  );

  if (!this.opts.disableImportExecutionFcU && fcuUpdate !== null) {
    this.executionEngine
      .notifyForkchoiceUpdate(
        fcuUpdate.fork,
        fcuUpdate.headBlockHash,
        fcuUpdate.safeBlockHash,
        fcuUpdate.finalizedBlockHash
      )
      .catch((e) => {
        if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
          this.logger.error("Error pushing notifyForkchoiceUpdate()", {blockHashHex}, e);
        }
      });
  }

  // 6. Record metrics for payload envelope and column sources
  const delaySec = this.clock.secFromSlot(slot);
  this.metrics?.importPayload.elapsedTimeTillImported.observe(
    {source: payloadInput.getPayloadEnvelopeSource().source},
    delaySec
  );
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  // 7. Emit event after payload is fully verified and imported to fork choice, only for recent enough payloads
  if (this.clock.currentSlot - slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayload, {
      slot,
      builderIndex: envelope.builderIndex,
      blockHash: blockHashHex,
      blockRoot: blockRootHex,
      executionOptimistic,
    });
  }

  this.logger.verbose("Execution payload imported", {
    slot,
    builderIndex: envelope.builderIndex,
    blockRoot: blockRootHex,
    blockHash: blockHashHex,
    delaySec,
  });
}

/**
 * Process an execution payload envelope end-to-end: wait for DA, then import.
 *
 * Used by the PayloadEnvelopeProcessor queue (gossip / API / unknown-payload sync) — i.e.
 * callers that have NOT already awaited DA themselves. Range sync's inline dispatch in
 * processBlocks skips this wrapper and calls `importExecutionPayload` directly, since
 * `verifyBlocksInEpoch` already awaited DA for the segment.
 */
export async function processExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  signal: AbortSignal,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability([payloadInput], signal);
  await importExecutionPayload.call(this, payloadInput, dataAvailabilityStatuses[0], opts);
}
