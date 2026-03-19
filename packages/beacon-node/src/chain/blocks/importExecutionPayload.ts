import {routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {
  BeaconStateView,
  CachedBeaconStateGloas,
  getExecutionPayloadEnvelopeSignatureSet,
} from "@lodestar/state-transition";
import {processExecutionPayloadEnvelope} from "@lodestar/state-transition/block";
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

/**
 * Import an execution payload envelope after all data is available.
 *
 * This function:
 * 1. Gets the ProtoBlock from fork choice
 * 2. Regenerates the block state
 * 3. Runs EL verification (notifyNewPayload) in parallel with signature verification and processExecutionPayloadEnvelope
 * 4. Updates fork choice
 * 5. Caches the post-execution payload state
 * 6. Records metrics for column sources
 *
 */
export async function importExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const envelope = payloadInput.getPayloadEnvelope();
  const blockRootHex = payloadInput.blockRootHex;

  // 1. Get ProtoBlock for parent root lookup
  const protoBlock = this.forkChoice.getBlockHexDefaultStatus(blockRootHex);
  if (!protoBlock) {
    throw new PayloadError({
      code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE,
      blockRootHex,
    });
  }

  // 2. Persist payload envelope to hot DB (performed asynchronously to avoid blocking)
  // Wait for space in the write queue to apply backpressure during sync.
  await this.unfinalizedPayloadEnvelopeWrites.waitForSpace();
  this.unfinalizedPayloadEnvelopeWrites.push(payloadInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error(
        "Error pushing payload envelope to unfinalized write queue",
        {slot: payloadInput.slot, root: blockRootHex},
        e as Error
      );
    }
  });

  // 3. Get pre-state for processExecutionPayloadEnvelope
  // We need the block state (post-block, pre-payload) to process the envelope
  const blockState = (await this.regen.getBlockSlotState(
    protoBlock,
    protoBlock.slot,
    {dontTransferCache: true},
    RegenCaller.processBlock
  )) as CachedBeaconStateGloas;

  // 4. Run verification steps in parallel
  // Note: No data availability check needed here - importExecutionPayload is only
  // called when payloadInput.isComplete() is true, so all data is already available.
  const [execResult, signatureValid, postPayloadResult] = await Promise.all([
    this.executionEngine.notifyNewPayload(
      ForkName.gloas,
      envelope.message.payload,
      payloadInput.getVersionedHashes(),
      fromHex(protoBlock.parentRoot),
      envelope.message.executionRequests
    ),

    opts.validSignature === true
      ? Promise.resolve(true)
      : (async () => {
          const signatureSet = getExecutionPayloadEnvelopeSignatureSet(
            this.config,
            blockState.epochCtx.pubkeyCache,
            new BeaconStateView(blockState),
            envelope,
            payloadInput.proposerIndex
          );
          return this.bls.verifySignatureSets([signatureSet]);
        })(),

    // Signature verified separately above.
    // State root check is done separately below with better error typing (matching block pipeline pattern).
    (async () => {
      try {
        return {
          postPayloadState: processExecutionPayloadEnvelope(blockState, envelope, {
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

  // 4b. Check signature verification result
  if (!signatureValid) {
    throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
  }

  // 5. Handle EL response
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
      // TODO GLOAS: Handle optimistic import for payload - for now treat as error
      throw new PayloadError({
        code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
        execStatus: execResult.status,
        errorMessage: execResult.validationError ?? "EL syncing, payload not yet validated",
      });

    case ExecutionPayloadStatus.INVALID_BLOCK_HASH:
    case ExecutionPayloadStatus.ELERROR:
    case ExecutionPayloadStatus.UNAVAILABLE:
      throw new PayloadError({
        code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
        execStatus: execResult.status,
        errorMessage: execResult.validationError ?? "",
      });
  }

  // 5b. Verify envelope state root matches post-state
  const postPayloadState = postPayloadResult.postPayloadState;
  const postPayloadStateRoot = postPayloadState.hashTreeRoot();
  if (!byteArrayEquals(envelope.message.stateRoot, postPayloadStateRoot)) {
    throw new PayloadError({
      code: PayloadErrorCode.STATE_TRANSITION_ERROR,
      message: `Envelope state root mismatch expected=${toRootHex(envelope.message.stateRoot)} actual=${toRootHex(postPayloadStateRoot)}`,
    });
  }

  // 6. Update fork choice
  this.forkChoice.onExecutionPayload(
    blockRootHex,
    payloadInput.getBlockHashHex(),
    envelope.message.payload.blockNumber,
    toRootHex(postPayloadStateRoot)
  );

  // 7. Cache payload state
  // TODO GLOAS: Enable when PR #8868 merged (adds processPayloadState)
  // this.regen.processPayloadState(postPayloadState);
  // if epoch boundary also call
  // this.regen.addCheckpointState(cp, checkpointState, true);

  // 8. Record metrics for payload envelope and column sources
  this.metrics?.importPayload.bySource.inc({source: payloadInput.getPayloadEnvelopeSource().source});
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  this.logger.verbose("Execution payload imported", {
    slot: payloadInput.slot,
    root: blockRootHex,
    blockHash: payloadInput.getBlockHashHex(),
  });

  // 9. Emit event after payload is fully verified and imported to fork choice, only for recent enough payloads
  const currentSlot = this.clock.currentSlot;
  if (currentSlot - payloadInput.slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayloadAvailable, {
      slot: payloadInput.slot,
      blockRoot: blockRootHex,
    });
  }
}
