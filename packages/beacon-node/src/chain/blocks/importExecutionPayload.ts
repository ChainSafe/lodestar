import {routes} from "@lodestar/api";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ExecutionStatus, PayloadExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {IBeaconStateView, getExecutionPayloadEnvelopeSignatureSet} from "@lodestar/state-transition";
import {byteArrayEquals, fromHex, toRootHex} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {BeaconChain} from "../chain.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
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

type VerifyExecutionPayloadResult = {
  postPayloadState: IBeaconStateView;
  execStatus: PayloadExecutionStatus;
};

/**
 * Verify an execution payload envelope:
 * 1. Emit `execution_payload_available` if payload is for current slot
 * 2. Get the ProtoBlock from fork choice
 * 3. Regenerate the block state
 * 4. Run EL verification, signature verification, and state transition in parallel
 * 5. Validate results (signature, EL status, state root)
 *
 * Returns the verified post-payload state and fork-choice execution status.
 */
export async function verifyExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  opts: ImportPayloadOpts = {}
): Promise<VerifyExecutionPayloadResult> {
  const signedEnvelope = payloadInput.getPayloadEnvelope();
  const envelope = signedEnvelope.message;
  const blockRootHex = payloadInput.blockRootHex;
  const fork = this.config.getForkName(envelope.slot);

  // TODO GLOAS: also wait for payload data availability
  // see https://github.com/ChainSafe/lodestar/issues/9150

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
  const protoBlock = this.forkChoice.getBlockHex(blockRootHex, PayloadStatus.EMPTY);
  if (!protoBlock) {
    throw new PayloadError({
      code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE,
      blockRootHex,
    });
  }

  // 3. Get pre-state for processExecutionPayloadEnvelope
  // We need the block state (post-block, pre-payload) to process the envelope
  const blockState = await this.regen.getBlockSlotState(
    protoBlock,
    protoBlock.slot,
    {dontTransferCache: true},
    RegenCaller.processBlock
  );

  // 4. Run verification steps in parallel
  // Note: No data availability check needed here - verifyExecutionPayload is only
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

  return {postPayloadState, execStatus: toForkChoiceExecutionStatus(execResult.status)};
}

/**
 * Import a pre-verified execution payload envelope:
 * 6. Applies write-queue backpressure (waitForSpace)
 * 7. Persists payload envelope to hot DB
 * 8. Updates fork choice
 * 9. Caches the post-payload state
 * 10. Records metrics for column sources
 * 11. Emits `execution_payload` for recent enough payloads
 *
 * Assumes verification already passed. Accepts pre-computed postPayloadState and execStatus,
 * so it can be reused from both processExecutionPayload() and the pre-verified processChainSegment path.
 */
export async function importExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  postPayloadState: IBeaconStateView,
  execStatus: PayloadExecutionStatus
): Promise<void> {
  const signedEnvelope = payloadInput.getPayloadEnvelope();
  const envelope = signedEnvelope.message;
  const blockRootHex = payloadInput.blockRootHex;
  const blockHashHex = payloadInput.getBlockHashHex();
  const postPayloadStateRoot = postPayloadState.hashTreeRoot();

  // 6. Apply backpressure from the write queue before doing persistence work.
  await this.unfinalizedPayloadEnvelopeWrites.waitForSpace();

  // 7. Persist payload envelope to hot DB (performed asynchronously to avoid blocking)
  this.unfinalizedPayloadEnvelopeWrites.push(payloadInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error(
        "Error pushing payload envelope to unfinalized write queue",
        {slot: envelope.slot, root: blockRootHex},
        e as Error
      );
    }
  });

  // 8. Update fork choice
  const oldHead = this.forkChoice.getHead();
  this.forkChoice.onExecutionPayload(
    blockRootHex,
    blockHashHex,
    envelope.payload.blockNumber,
    toRootHex(postPayloadStateRoot),
    execStatus
  );
  const newHead = this.recomputeForkChoiceHead(ForkchoiceCaller.importPayload);

  if (newHead.blockRoot !== oldHead.blockRoot) {
    this.regen.updateHeadState(newHead, postPayloadState);
    this.logger.verbose("New chain head after execution payload import", {
      slot: newHead.slot,
      root: newHead.blockRoot,
      payloadStatus: newHead.payloadStatus === PayloadStatus.FULL ? "full" : "empty",
      executionOptimistic: isOptimisticBlock(newHead),
    });
    if (this.metrics) {
      this.metrics.headSlot.set(newHead.slot);
    }
    this.onNewHead(newHead);
    this.metrics?.forkChoice.changedHead.inc();
  }

  // 9. Cache payload state
  this.regen.processPayloadState(postPayloadState);
  if (postPayloadState.slot % SLOTS_PER_EPOCH === 0) {
    const {checkpoint} = postPayloadState.computeAnchorCheckpoint();
    this.regen.addCheckpointState(checkpoint, postPayloadState, true);
  }

  // 10. Record metrics for payload envelope and column sources
  this.metrics?.importPayload.bySource.inc({source: payloadInput.getPayloadEnvelopeSource().source});
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  // 11. Emit event after payload is fully verified and imported to fork choice, only for recent enough payloads
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

/**
 * Process an execution payload envelope end-to-end:
 * verifies it (steps 1-5) then imports it (steps 6-11).
 *
 * Used by PayloadEnvelopeProcessor for the normal gossip/req-resp path.
 * For the pre-verified processChainSegment path, call importExecutionPayload() directly.
 */
export async function processExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const {postPayloadState, execStatus} = await verifyExecutionPayload.call(this, payloadInput, opts);
  await importExecutionPayload.call(this, payloadInput, postPayloadState, execStatus);
}
