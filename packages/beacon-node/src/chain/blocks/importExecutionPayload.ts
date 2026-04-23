import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadExecutionStatus} from "@lodestar/fork-choice";
import {isStatePostGloas} from "@lodestar/state-transition";
import {fromHex} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {BeaconChain} from "../chain.js";
import {RegenCaller} from "../regen/interface.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {ImportPayloadOpts} from "./types.js";
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
 * The envelope is only verified here, no state mutation. State effects from the payload
 * are applied on the next block via processParentExecutionPayload.
 *
 * Steps:
 * 1. Emit `execution_payload_available` event for payload attestation
 * 2. Get the ProtoBlock from fork choice
 * 3. Wait for data columns to be available
 * 4. Regenerate state for envelope verification
 * 5. Verify envelope (fields against state, signature, and EL in parallel where possible)
 * 6. Persist verified payload envelope to hot DB (waits for write-queue space for backpressure)
 * 7. Update fork choice (transitions the block's PENDING variant to FULL)
 * 8. Record metrics for payload envelope and column sources
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

  // 3. Wait for data columns to be available.
  // The helper is shared with future gloas sync services; take the single-item batch form here.
  await verifyPayloadsDataAvailability([payloadInput], signal);

  // 4. Regenerate state for envelope verification
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

  // 5. Verify envelope against state (spec: verify_execution_payload_envelope). Run the sync
  // field checks first to fail fast before starting the EL + BLS work. When validSignature is
  // true, the envelope came from gossip/API where both the signature and executionRequestsRoot
  // were already verified, skip re-hashing executionRequestsRoot.
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

  if (!signatureValid) {
    throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
  }

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

  // 6. Persist payload envelope to hot DB. Wait for write-queue space here to apply backpressure
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

  // 7. Update fork choice, transitions the block's PENDING variant to FULL
  const execStatus = toForkChoiceExecutionStatus(execResult.status);
  this.forkChoice.onExecutionPayload(blockRootHex, blockHashHex, envelope.payload.blockNumber, execStatus);

  // 8. Record metrics for payload envelope and column sources
  this.metrics?.importPayload.bySource.inc({source: payloadInput.getPayloadEnvelopeSource().source});
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  // 9. Emit `execution_payload` event for recent enough payloads after successful import
  if (this.clock.currentSlot - slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayload, {
      slot,
      builderIndex: envelope.builderIndex,
      blockHash: blockHashHex,
      blockRoot: blockRootHex,
      // TODO GLOAS: revisit once we support optimistic import
      executionOptimistic: false,
    });
  }

  this.logger.verbose("Execution payload imported", {
    slot,
    builderIndex: envelope.builderIndex,
    blockRoot: blockRootHex,
    blockHash: blockHashHex,
  });
}
