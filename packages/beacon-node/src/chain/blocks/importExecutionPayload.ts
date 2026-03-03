import {PublicKey} from "@chainsafe/blst";
import {ForkName} from "@lodestar/params";
import {
  CachedBeaconStateGloas,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadEnvelopeSigningRoot,
} from "@lodestar/state-transition";
import {processExecutionPayloadEnvelope} from "@lodestar/state-transition/block";
import {byteArrayEquals, fromHex, toRootHex} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {BeaconChain} from "../chain.js";
import {RegenCaller} from "../regen/interface.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {ImportPayloadOpts} from "./types.js";

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

export type ImportPayloadResult = {
  success: boolean;
};

/**
 * Import an execution payload envelope after all data is available.
 *
 * This function:
 * 1. Gets the ProtoBlock from fork choice
 * 2. Regenerates the block state
 * 3. Runs EL verification (notifyNewPayload) in parallel with state transition
 * 4. Updates fork choice from PENDING → FULL status
 * 5. Caches the post-state
 * 6. Records metrics for column sources
 *
 * Note: The actual DB write happens asynchronously via writePayloadEnvelopeInputToDb
 */
export async function importExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  opts: ImportPayloadOpts = {}
): Promise<ImportPayloadResult> {
  const envelope = payloadInput.getPayloadEnvelope();
  const blockRootHex = payloadInput.blockRootHex;

  // 1. Get ProtoBlock for parent root lookup
  const protoBlock = this.forkChoice.getBlockHex(blockRootHex);
  if (!protoBlock) {
    throw new PayloadError({
      code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE,
      blockRootHex,
    });
  }

  // 2. Get pre-state for state transition
  // We need the block state (post-block, pre-payload) to process the envelope
  const blockState = (await this.regen.getBlockSlotState(
    protoBlock,
    protoBlock.slot,
    {dontTransferCache: true},
    RegenCaller.processBlock
  )) as CachedBeaconStateGloas;

  // 3. Run verification steps in parallel (like verifyBlocksInEpoch)
  // Note: No data availability check needed here - importExecutionPayload is only
  // called when payloadInput.isComplete() is true, so all data is already available.
  const [execResult, signatureValid, postPayloadResult] = await Promise.all([
    // EL verification - notifyNewPayload
    this.executionEngine.notifyNewPayload(
      ForkName.gloas,
      envelope.message.payload,
      payloadInput.getVersionedHashes(),
      fromHex(protoBlock.parentRoot),
      envelope.message.executionRequests
    ),

    // Signature verification (skip if already verified during gossip/API validation)
    opts.validSignature === true
      ? Promise.resolve(true)
      : (async () => {
          const signatureSet = createSingleSignatureSetFromComponents(
            PublicKey.fromBytes(blockState.builders.getReadonly(envelope.message.builderIndex).pubkey),
            getExecutionPayloadEnvelopeSigningRoot(this.config, envelope.message),
            envelope.signature
          );
          return this.bls.verifySignatureSets([signatureSet]);
        })(),

    // Process execution payload envelope (state transition)
    // Signature verified separately above (matching block pipeline pattern).
    // State root check is done separately below with better error typing (matching block pipeline pattern).
    (async () => {
      try {
        // Clone state to avoid mutating the cached state
        const mutableState = blockState.clone();
        processExecutionPayloadEnvelope(mutableState, envelope, {verifySignature: false, verifyStateRoot: false});
        return {postPayloadState: mutableState};
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

  // 3b. Check signature verification result
  if (!signatureValid) {
    throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
  }

  // 4. Handle EL response
  if (execResult.status === ExecutionPayloadStatus.INVALID) {
    throw new PayloadError({
      code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
      execStatus: execResult.status,
      errorMessage: execResult.validationError ?? "",
    });
  }

  if (
    execResult.status === ExecutionPayloadStatus.INVALID_BLOCK_HASH ||
    execResult.status === ExecutionPayloadStatus.ELERROR ||
    execResult.status === ExecutionPayloadStatus.UNAVAILABLE
  ) {
    throw new PayloadError({
      code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
      execStatus: execResult.status,
      errorMessage: execResult.validationError ?? "",
    });
  }

  // VALID, ACCEPTED, or SYNCING - proceed with import

  // 4b. Verify envelope state root matches post-state (done separately from state transition, like block pipeline)
  const postPayloadState = postPayloadResult.postPayloadState;
  const stateRoot = postPayloadState.hashTreeRoot();
  if (!byteArrayEquals(envelope.message.stateRoot, stateRoot)) {
    throw new PayloadError(
      {
        code: PayloadErrorCode.STATE_TRANSITION_ERROR,
        message: `Envelope state root mismatch expected=${toRootHex(envelope.message.stateRoot)} actual=${toRootHex(stateRoot)}`,
      },
      `Envelope state root mismatch expected=${toRootHex(envelope.message.stateRoot)} actual=${toRootHex(stateRoot)}`
    );
  }

  // 5. Update fork choice: PENDING → FULL
  // TODO GLOAS: Update API when nc/epbs-fc merged
  // this.forkChoice.onExecutionPayload(
  //   envelope.message.beaconBlockRoot,
  //   postPayloadState.hashTreeRoot()
  // );

  // 6. Cache payload state
  // TODO GLOAS: Enable when PR #8868 merged (adds processPayloadState)
  // this.regen.processPayloadState(postPayloadState);

  // 7. Record metrics for payload envelope and column sources
  this.metrics?.importPayload.bySource.inc({source: payloadInput.getPayloadEnvelopeSource().source});
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  // 8. Write payload envelope to DB (handled separately, see writePayloadEnvelopeInputToDb)
  // The write + prune happens asynchronously after import completes

  return {success: true};
}
