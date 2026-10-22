import {
  ExecutionStatus,
  PayloadExecutionStatus,
  getFinalizedExecutionBlockHash,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {DataAvailabilityStatus, isStatePostGloas} from "@lodestar/state-transition";
import {WithBytes, gloas, ssz} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {PayloadEnvelopeInputSource} from "../blocks/payloadEnvelopeInput/index.js";
import {PayloadError, PayloadErrorCode} from "../blocks/payloadError.js";
import {
  verifyExecutionPayloadEnvelope,
  verifyExecutionPayloadEnvelopeSignature,
} from "../blocks/verifyExecutionPayloadEnvelope.js";
import {RegenCaller} from "../regen/index.js";
import {BeaconEngineCore} from "./beaconEngineCore.js";
import {BeaconEngineEvent} from "./events.js";
import {ImportExecutionPayloadOpts} from "./interface.js";

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
 * Runs inside BeaconEngineCore. Moved from unstable@1bf214377e packages/beacon-node/src/chain/blocks/importExecutionPayload.ts#importExecutionPayload.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function importExecutionPayloadBytes(
  this: BeaconEngineCore,
  // [beacon-engine] deviation: serialized envelope replaces the upstream payload-input object.
  envelopeBytes: Uint8Array,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportExecutionPayloadOpts
): Promise<{executionOptimistic: boolean}> {
  let signedEnvelope: gloas.SignedExecutionPayloadEnvelope;
  try {
    signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(envelopeBytes, {reuseBytes: true});
  } catch (e) {
    throw new PayloadError({code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: (e as Error).message});
  }
  return importExecutionPayload.call(this, {data: signedEnvelope, bytes: envelopeBytes}, dataAvailabilityStatus, opts);
}

export async function importExecutionPayload(
  this: BeaconEngineCore,
  {data: signedEnvelope, bytes: envelopeBytes}: WithBytes<gloas.SignedExecutionPayloadEnvelope>,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportExecutionPayloadOpts
): Promise<{executionOptimistic: boolean}> {
  const envelope = signedEnvelope.message;
  const blockRoot = envelope.beaconBlockRoot;
  const blockRootHex = toRootHex(blockRoot);
  const blockHashHex = toRootHex(envelope.payload.blockHash);

  // Get the ProtoBlock for the block whose payload this envelope carries.
  const protoBlock = this.forkChoice.getBlockHexDefaultStatus(blockRootHex);
  if (!protoBlock) {
    throw new PayloadError({code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE, blockRootHex});
  }

  // Regenerate state for envelope verification.
  const blockState = await this.regen
    .getBlockSlotState(protoBlock, protoBlock.slot, {dontTransferCache: true}, RegenCaller.importExecutionPayload)
    .catch(() =>
      // only happen at the 1st batch of skipped slot checkpoint sync
      this.regen.getClosestHeadState(protoBlock)
    );

  if (blockState == null) {
    throw new PayloadError({code: PayloadErrorCode.MISS_BLOCK_STATE, blockRootHex: protoBlock.blockRoot});
  }
  if (!isStatePostGloas(blockState)) {
    throw new PayloadError({
      code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR,
      message: `Expected gloas+ state for payload import, got fork=${blockState.forkName}`,
    });
  }

  // Verify envelope fields against state. When validSignature is true, gossip/API already verified
  // both the signature and the executionRequestsRoot, so we skip those checks here.
  try {
    verifyExecutionPayloadEnvelope(this.config, blockState, envelope, {
      verifyExecutionRequestsRoot: !opts.validSignature,
    });
  } catch (e) {
    this.seenPayloadEnvelopeInputCache.removeInvalid(signedEnvelope);
    throw new PayloadError(
      {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: (e as Error).message},
      `Envelope verification error: ${(e as Error).message}`
    );
  }

  // Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts, steps 4a-4c.
  // The state supplies the committed bid instead of crossing the DA input into the engine.
  const slot = envelope.payload.slotNumber;
  const fork = this.config.getForkName(slot);
  const logCtx = {slot, root: blockRootHex, executionBlock: envelope.payload.blockNumber};
  this.logger.debug("Call engine api newPayload", logCtx);
  const verifyStartSec = Date.now() / 1000;
  const [execResult, signatureValid] = await Promise.all([
    this.executionEngine.notifyNewPayload(
      fork,
      envelope.payload,
      blockState.latestExecutionPayloadBid.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      envelope.parentBeaconBlockRoot,
      envelope.executionRequests
    ),
    opts.validSignature === true
      ? Promise.resolve(true)
      : verifyExecutionPayloadEnvelopeSignature(
          this.config,
          blockState,
          signedEnvelope,
          blockState.latestBlockHeader.proposerIndex,
          this.bls
        ),
  ]);
  this.logger.debug("Receive engine api newPayload result", {...logCtx, status: execResult.status});
  this.metrics?.engineNotifyNewPayloadResult.inc({result: execResult.status});
  if (!signatureValid) {
    this.seenPayloadEnvelopeInputCache.removeInvalid(signedEnvelope);
    throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
  }

  switch (execResult.status) {
    case ExecutionPayloadStatus.VALID:
      break;

    case ExecutionPayloadStatus.INVALID:
      this.seenPayloadEnvelopeInputCache.removeInvalid(signedEnvelope);
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

  const {source, seenTimestampSec} = opts;
  const payloadInput =
    this.seenPayloadEnvelopeInputCache.get(blockRootHex) ??
    this.seenPayloadEnvelopeInputCache.addFromBid({
      blockRootHex,
      slot: protoBlock.slot,
      forkName: fork,
      proposerIndex: blockState.latestBlockHeader.proposerIndex,
      bid: ssz.gloas.ExecutionPayloadBid.clone(blockState.latestExecutionPayloadBid),
    });
  payloadInput.addPayloadEnvelope({
    envelope: signedEnvelope,
    source: source ?? PayloadEnvelopeInputSource.engine,
    seenTimestampSec: seenTimestampSec ?? Date.now() / 1000,
  });
  if (
    execResult.status === ExecutionPayloadStatus.VALID &&
    source === PayloadEnvelopeInputSource.gossip &&
    seenTimestampSec !== undefined
  ) {
    const nowSec = Date.now() / 1000;
    this.metrics?.gossipExecutionPayloadEnvelope.executionPayload.recvToValidation.observe(nowSec - seenTimestampSec);
    // same metric as pre-gloas, it tracks EL verification time regardless of fork
    this.metrics?.gossipBlock.executionPayload.validationTime.observe(nowSec - verifyStartSec);
  }

  const execStatus = toForkChoiceExecutionStatus(execResult.status);

  // [beacon-engine] deviation from upstream step 5: await the envelope write before FULL.
  // Columns remain in BeaconChain's write queue, as for chain/beaconEngine/importBlock.ts.
  await this.db.executionPayloadEnvelope.putBinary(blockRoot, envelopeBytes);

  this.forkChoice.onExecutionPayload(
    blockRootHex,
    blockHashHex,
    envelope.payload.blockNumber,
    envelope.payload.gasLimit,
    execStatus,
    dataAvailabilityStatus
  );

  this.publishChainView();

  // Fire the FCU only when this payload's block is the canonical head.
  const head = this.forkChoice.getHead();
  if (!this.opts.disableImportExecutionFcU && blockRootHex === head.blockRoot) {
    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice, this.logger);
    const finalizedBlockHash = getFinalizedExecutionBlockHash(this.forkChoice);
    this.executionEngine.notifyForkchoiceUpdate(fork, blockHashHex, safeBlockHash, finalizedBlockHash).catch((e) => {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.logger.error("Error pushing notifyForkchoiceUpdate()", {blockHashHex, finalizedBlockHash}, e);
      }
    });
  }

  const executionOptimistic = execStatus === ExecutionStatus.Syncing;
  this.emitter.emit(BeaconEngineEvent.executionPayloadImported, {
    slot: envelope.payload.slotNumber,
    builderIndex: envelope.builderIndex,
    blockHash: blockHashHex,
    blockRoot: blockRootHex,
    executionOptimistic,
  });
  return {executionOptimistic};
}
