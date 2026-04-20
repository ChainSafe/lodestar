import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadExecutionStatus} from "@lodestar/fork-choice";
import {isStatePostGloas} from "@lodestar/state-transition";
import {verifyExecutionPayloadEnvelope, verifyExecutionPayloadEnvelopeSignature} from "./verifyExecutionPayloadEnvelope.js";
import {fromHex} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {BeaconChain} from "../chain.js";
import {RegenCaller} from "../regen/interface.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {ImportPayloadOpts} from "./types.js";
import {verifyPayloadsDataAvailability} from "./verifyPayloadsDataAvailability.js";

const EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS = 64;

export enum PayloadErrorCode {
  EXECUTION_ENGINE_INVALID = "PAYLOAD_ERROR_EXECUTION_ENGINE_INVALID",
  EXECUTION_ENGINE_ERROR = "PAYLOAD_ERROR_EXECUTION_ENGINE_ERROR",
  BLOCK_NOT_IN_FORK_CHOICE = "PAYLOAD_ERROR_BLOCK_NOT_IN_FORK_CHOICE",
  STATE_TRANSITION_ERROR = "PAYLOAD_ERROR_STATE_TRANSITION_ERROR",
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
      code: PayloadErrorCode.STATE_TRANSITION_ERROR;
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
    // TODO GLOAS: Handle optimistic import for payload
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
 * With deferred processing (consensus-specs#5094), the envelope is purely verified
 * here — no state mutation. State effects are applied in the next block via
 * processParentExecutionPayload.
 *
 * Steps:
 * 1. Emit `execution_payload_available` for payload attestation
 * 2. Get the ProtoBlock from fork choice
 * 3. Apply write-queue backpressure
 * 4. Regenerate block state for envelope field validation
 * 5. Run EL verification and signature verification in parallel, plus pure envelope verification
 * 6. Persist verified payload envelope to hot DB
 * 7. Update fork choice (no stateRoot — FULL shares PENDING's stateRoot)
 * 8. Record metrics
 * 9. Emit `execution_payload` event
 */
export async function importExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  signal: AbortSignal,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const signedEnvelope = payloadInput.getPayloadEnvelope();
  const envelope = signedEnvelope.message;
  const blockRootHex = payloadInput.blockRootHex;
  const blockHashHex = payloadInput.getBlockHashHex();
  const fork = this.config.getForkName(envelope.payload.slotNumber);

  // 1. Emit `execution_payload_available` event at the start of import
  if (this.clock.currentSlot - envelope.payload.slotNumber < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayloadAvailable, {
      slot: envelope.payload.slotNumber,
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

  // 3. Wait for data columns to be available before claiming a write-queue slot.
  // The helper is shared with future gloas sync services; take the single-item batch form here.
  await verifyPayloadsDataAvailability([payloadInput], signal);

  // 4. Apply backpressure from the write queue, before doing verification work.
  // The actual DB write is deferred until after verification succeeds.
  await this.unfinalizedPayloadEnvelopeWrites.waitForSpace();

  // 5. Get pre-state for processExecutionPayloadEnvelope
  // We need the block state (post-block, pre-payload) to process the envelope
  const blockState = await this.regen.getBlockSlotState(
    protoBlock,
    protoBlock.slot,
    {dontTransferCache: true},
    RegenCaller.processBlock
  );
  if (!isStatePostGloas(blockState)) {
    throw new PayloadError({
      code: PayloadErrorCode.STATE_TRANSITION_ERROR,
      message: `Expected gloas+ block state for payload import, got fork=${blockState.forkName}`,
    });
  }

  // 5. Run verification steps in parallel
  const [execResult, signatureValid] = await Promise.all([
    this.executionEngine.notifyNewPayload(
      fork,
      envelope.payload,
      payloadInput.getVersionedHashes(),
      fromHex(protoBlock.parentRoot),
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

  // 5a. Verify envelope fields against state (spec: verify_execution_payload_envelope)
  try {
    // When validSignature is true, the envelope came from gossip/API where both
    // signature and executionRequestsRoot were already verified — skip re-hashing
    verifyExecutionPayloadEnvelope(this.config, blockState, envelope, {
      verifyExecutionRequestsRoot: !opts.validSignature,
    });
  } catch (e) {
    throw new PayloadError(
      {
        code: PayloadErrorCode.STATE_TRANSITION_ERROR,
        message: (e as Error).message,
      },
      `Envelope verification error: ${(e as Error).message}`
    );
  }

  // 5b. Check signature verification result
  if (!signatureValid) {
    throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
  }

  // 5c. Handle EL response
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

  // 6. Persist payload envelope to hot DB
  this.unfinalizedPayloadEnvelopeWrites.push(payloadInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error(
        "Error pushing payload envelope to unfinalized write queue",
        {slot: envelope.payload.slotNumber, blockRoot: blockRootHex},
        e as Error
      );
    }
  });

  // 7. Update fork choice — no separate stateRoot since envelope doesn't produce post-state
  const execStatus = toForkChoiceExecutionStatus(execResult.status);
  this.forkChoice.onExecutionPayload(blockRootHex, blockHashHex, envelope.payload.blockNumber, execStatus);

  // 8. Record metrics for payload envelope and column sources
  this.metrics?.importPayload.bySource.inc({source: payloadInput.getPayloadEnvelopeSource().source});
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  // 9. Emit event after payload is fully verified and imported to fork choice
  if (this.clock.currentSlot - envelope.payload.slotNumber < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayload, {
      slot: envelope.payload.slotNumber,
      builderIndex: envelope.builderIndex,
      blockHash: blockHashHex,
      blockRoot: blockRootHex,
      // TODO GLOAS: revisit once we support optimistic import
      executionOptimistic: false,
    });
  }

  this.logger.verbose("Execution payload imported", {
    slot: envelope.payload.slotNumber,
    builderIndex: envelope.builderIndex,
    blockRoot: blockRootHex,
    blockHash: blockHashHex,
  });
}
