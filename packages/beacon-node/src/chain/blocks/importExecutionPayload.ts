import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadExecutionStatus, getSafeExecutionBlockHash} from "@lodestar/fork-choice";
import {DataAvailabilityStatus, isStatePostGloas} from "@lodestar/state-transition";
import {isErrorAborted} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {ExecutionPayloadStatus, isForkchoiceUpdateInvalidError} from "../../execution/index.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {BeaconChain} from "../chain.js";
import {RegenCaller} from "../regen/interface.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {ImportPayloadOpts} from "./types.js";
import {invalidateForkchoiceHeadFromFcuInvalid} from "./utils/forkchoiceUpdateInvalid.js";
import {
  verifyExecutionPayloadEnvelope,
  verifyExecutionPayloadEnvelopeSignature,
} from "./verifyExecutionPayloadEnvelope.js";
import {verifyPayloadsDataAvailability} from "./verifyPayloadsDataAvailability.js";

const EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS = 64;

export enum PayloadErrorCode {
  EXECUTION_ENGINE_INVALID = "PAYLOAD_ERROR_EXECUTION_ENGINE_INVALID",
  EXECUTION_ENGINE_ERROR = "PAYLOAD_ERROR_EXECUTION_ENGINE_ERROR",
  BLOCK_NOT_IN_FORK_CHOICE = "PAYLOAD_ERROR_BLOCK_NOT_IN_FORK_CHOICE",
  ENVELOPE_VERIFICATION_ERROR = "PAYLOAD_ERROR_ENVELOPE_VERIFICATION_ERROR",
  INVALID_SIGNATURE = "PAYLOAD_ERROR_INVALID_SIGNATURE",
}

export type PayloadErrorType =
  | {
      code: PayloadErrorCode.EXECUTION_ENGINE_INVALID;
      execStatus: ExecutionPayloadStatus;
      errorMessage: string;
    }
  | {
      code: PayloadErrorCode.EXECUTION_ENGINE_ERROR;
      execStatus: ExecutionPayloadStatus;
      errorMessage: string;
    }
  | {
      code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE;
      blockRootHex: string;
    }
  | {
      code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR;
      message: string;
    }
  | {
      code: PayloadErrorCode.INVALID_SIGNATURE;
    };

export class PayloadError extends Error {
  type: PayloadErrorType;

  constructor(type: PayloadErrorType, message?: string) {
    super(message ?? type.code);
    this.type = type;
  }
}

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
 * Steps:
 * 1. Emit `execution_payload_available` event for payload attestation
 * 2. Get the ProtoBlock from fork choice
 * 3. Regenerate state for envelope verification
 * 4. Verify envelope (fields against state, signature, and EL in parallel where possible)
 * 5. Persist verified payload envelope to hot DB (waits for write-queue space for backpressure)
 * 6. Update fork choice (transitions the block's PENDING variant to FULL)
 * 7. Queue notifyForkchoiceUpdate to engine api
 * 8. Record metrics for payload envelope and column sources
 * 9. Emit `execution_payload` event
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

  // 2. Get ProtoBlock for parent root lookup
  const protoBlock = this.forkChoice.getBlockHexDefaultStatus(blockRootHex);
  if (!protoBlock) {
    throw new PayloadError({
      code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE,
      blockRootHex,
    });
  }

  // 3. Regenerate state for envelope verification
  const blockState = await this.regen.getBlockSlotState(
    protoBlock,
    protoBlock.slot,
    {dontTransferCache: true},
    RegenCaller.processBlock
  );
  if (!isStatePostGloas(blockState)) {
    throw new PayloadError({
      code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR,
      message: `Expected gloas+ state for payload import, got fork=${blockState.forkName}`,
    });
  }

  // 4. Verify envelope fields against state first to fail fast before the EL + BLS work.
  // When validSignature is true, gossip/API has already verified both the signature and the
  // executionRequestsRoot, so we skip those checks here.
  try {
    verifyExecutionPayloadEnvelope(this.config, blockState, envelope, {
      verifyExecutionRequestsRoot: !opts.validSignature,
    });
  } catch (e) {
    throw new PayloadError(
      {
        code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR,
        message: (e as Error).message,
      },
      `Envelope verification error: ${(e as Error).message}`
    );
  }

  // 4a. Run EL and signature verification in parallel
  const [execResult, signatureValid] = await Promise.all([
    this.executionEngine.notifyNewPayload(
      fork,
      envelope.payload,
      payloadInput.getVersionedHashes(),
      envelope.parentBeaconBlockRoot,
      envelope.executionRequests
    ),

    opts.validSignature === true
      ? Promise.resolve(true)
      : verifyExecutionPayloadEnvelopeSignature(
          this.config,
          blockState,
          this.pubkeyCache,
          signedEnvelope,
          payloadInput.proposerIndex,
          this.bls
        ),
  ]);

  // 4b. Check signature verification result
  if (!signatureValid) {
    throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
  }

  // 4c. Handle EL response
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

  // 5. Persist payload envelope to hot DB. Wait for write-queue space here to apply backpressure
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

  // 6. Update fork choice, transitions the block's PENDING variant to FULL
  const execStatus = toForkChoiceExecutionStatus(execResult.status);
  this.forkChoice.onExecutionPayload(
    blockRootHex,
    blockHashHex,
    envelope.payload.blockNumber,
    execStatus,
    dataAvailabilityStatus
  );

  // 7. Queue notifyForkchoiceUpdate to engine api
  const head = this.forkChoice.getHead();
  if (!this.opts.disableImportExecutionFcU && blockRootHex === head.blockRoot) {
    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice);
    const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    this.executionEngine.notifyForkchoiceUpdate(fork, blockHashHex, safeBlockHash, finalizedBlockHash).catch((e) => {
      if (isForkchoiceUpdateInvalidError(e)) {
        invalidateForkchoiceHeadFromFcuInvalid(this, head.blockRoot, blockHashHex, e);
        return;
      }
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.logger.error("Error pushing notifyForkchoiceUpdate()", {blockHashHex, finalizedBlockHash}, e);
      }
    });
  }

  // 8. Record metrics for payload envelope and column sources
  this.metrics?.importPayload.bySource.inc({source: payloadInput.getPayloadEnvelopeSource().source});
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  // 9. Emit event after payload is fully verified and imported to fork choice, only for recent enough payloads
  if (this.clock.currentSlot - slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayload, {
      slot,
      builderIndex: envelope.builderIndex,
      blockHash: blockHashHex,
      blockRoot: blockRootHex,
      executionOptimistic: execStatus === ExecutionStatus.Syncing,
    });
  }

  this.logger.verbose("Execution payload imported", {
    slot,
    builderIndex: envelope.builderIndex,
    blockRoot: blockRootHex,
    blockHash: blockHashHex,
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
