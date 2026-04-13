import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadExecutionStatus} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getExecutionPayloadEnvelopeSignatureSet} from "@lodestar/state-transition";
import {byteArrayEquals, fromHex, toRootHex} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {BeaconChain} from "../chain.js";
import {RegenCaller} from "../regen/interface.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {ImportPayloadOpts} from "./types.js";

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
 * This function:
 * 1. Emits `execution_payload_available` if payload is for current slot
 * 2. Gets the ProtoBlock from fork choice
 * 3. Applies write-queue backpressure (waitForSpace) early, before verification
 * 4. Regenerates the block state
 * 5. Runs EL verification (notifyNewPayload) in parallel with signature verification and processExecutionPayloadEnvelope
 * 6. Persists verified payload envelope to hot DB
 * 7. Updates fork choice
 * 8. Caches the post-execution payload state
 * 9. Records metrics for column sources
 * 10. Emits `execution_payload` for recent enough payloads after successful import
 *
 */
export async function importExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const signedEnvelope = payloadInput.getPayloadEnvelope();
  const envelope = signedEnvelope.message;
  const blockRootHex = payloadInput.blockRootHex;
  const blockHashHex = payloadInput.getBlockHashHex();
  const fork = this.config.getForkName(envelope.slot);

  // 1. Emit `execution_payload_available` event at the start of import. At this point the payload input
  // is already complete, so the payload and required data are available for payload attestation.
  // This event is only about availability, not validity of the execution payload, hence we can emit
  // it before getting a response from the execution client on whether the payload is valid or not.
  if (this.clock.currentSlot === envelope.slot) {
    this.emitter.emit(routes.events.EventType.executionPayloadAvailable, {
      slot: envelope.slot,
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

  // 3. Apply backpressure from the write queue early, before doing verification work.
  // The actual DB write is deferred until after verification succeeds.
  await this.unfinalizedPayloadEnvelopeWrites.waitForSpace();

  // 4. Get pre-state for processExecutionPayloadEnvelope
  // We need the block state (post-block, pre-payload) to process the envelope
  const blockState = await this.regen.getBlockSlotState(
    protoBlock,
    protoBlock.slot,
    {dontTransferCache: true},
    RegenCaller.processBlock
  );

  // 5. Run verification steps in parallel
  // Note: No data availability check needed here - importExecutionPayload is only
  // called when payloadInput.isComplete() is true, so all data is already available.
  const [execResult, signatureValid, postPayloadResult] = await Promise.all([
    this.executionEngine.notifyNewPayload(
      fork,
      envelope.payload,
      payloadInput.getVersionedHashes(),
      fromHex(protoBlock.parentRoot),
      envelope.executionRequests
    ),

    opts.validSignature === true
      ? Promise.resolve(true)
      : (async () => {
          const signatureSet = getExecutionPayloadEnvelopeSignatureSet(
            this.config,
            this.pubkeyCache,
            blockState,
            signedEnvelope,
            payloadInput.proposerIndex
          );
          return this.bls.verifySignatureSets([signatureSet]);
        })(),

    // Signature verified separately above.
    // State root check is done separately below with better error typing (matching block pipeline pattern).
    (async () => {
      try {
        return {
          postPayloadState: blockState.processExecutionPayloadEnvelope(signedEnvelope, {
            verifySignature: false,
            verifyStateRoot: false,
          }),
        };
      } catch (e) {
        throw new PayloadError(
          {
            code: PayloadErrorCode.STATE_TRANSITION_ERROR,
            message: (e as Error).message,
          },
          `State transition error: ${(e as Error).message}`
        );
      }
    })(),
  ]);

  // 5a. Check signature verification result
  if (!signatureValid) {
    throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
  }

  // 5b. Handle EL response
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

  // 5c. Verify envelope state root matches post-state
  const postPayloadState = postPayloadResult.postPayloadState;
  const postPayloadStateRoot = postPayloadState.hashTreeRoot();
  if (!byteArrayEquals(envelope.stateRoot, postPayloadStateRoot)) {
    throw new PayloadError({
      code: PayloadErrorCode.STATE_TRANSITION_ERROR,
      message: `Envelope state root mismatch expected=${toRootHex(envelope.stateRoot)} actual=${toRootHex(postPayloadStateRoot)}`,
    });
  }

  // 6. Persist payload envelope to hot DB (performed asynchronously to avoid blocking)
  this.unfinalizedPayloadEnvelopeWrites.push(payloadInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error(
        "Error pushing payload envelope to unfinalized write queue",
        {slot: envelope.slot, root: blockRootHex},
        e as Error
      );
    }
  });

  // 7. Update fork choice
  this.forkChoice.onExecutionPayload(
    blockRootHex,
    blockHashHex,
    envelope.payload.blockNumber,
    toRootHex(postPayloadStateRoot),
    toForkChoiceExecutionStatus(execResult.status)
  );

  // 8. Cache payload state
  this.regen.processPayloadState(postPayloadState);
  if (postPayloadState.slot % SLOTS_PER_EPOCH === 0) {
    const {checkpoint} = postPayloadState.computeAnchorCheckpoint();
    this.regen.addCheckpointState(checkpoint, postPayloadState, true);
  }

  // 9. Record metrics for payload envelope and column sources
  this.metrics?.importPayload.bySource.inc({source: payloadInput.getPayloadEnvelopeSource().source});
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  // 10. Emit event after payload is fully verified and imported to fork choice, only for recent enough payloads
  if (this.clock.currentSlot - envelope.slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayload, {
      slot: envelope.slot,
      builderIndex: envelope.builderIndex,
      blockHash: blockHashHex,
      blockRoot: blockRootHex,
      stateRoot: toRootHex(envelope.stateRoot),
      // TODO GLOAS: revisit once we support optimistic import
      executionOptimistic: false,
    });
  }

  this.logger.verbose("Execution payload imported", {
    slot: envelope.slot,
    root: blockRootHex,
    blockHash: blockHashHex,
  });
}
