import {SerializedList} from "@chainsafe/ssz";
import {
  ExecutionStatus,
  PayloadExecutionStatus,
  PayloadStatus,
  getFinalizedExecutionBlockHash,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {
  DataAvailabilityStatus,
  computeEpochAtSlot,
  isStatePostGloas,
  isStatePostHeze,
} from "@lodestar/state-transition";
import {RootHex, WithBytes, bellatrix, gloas, ssz} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {PayloadEnvelopeInputSource} from "../blocks/payloadEnvelopeInput/index.js";
import {PayloadError, PayloadErrorCode} from "../blocks/payloadError.js";
import {
  verifyExecutionPayloadEnvelope,
  verifyExecutionPayloadEnvelopeSignature,
} from "../blocks/verifyExecutionPayloadEnvelope.js";
import {RegenCaller} from "../regen/index.js";
import {BeaconEngineCore} from "./beaconEngineCore.js";
import {ImportExecutionPayloadOpts, ImportExecutionPayloadResult} from "./interface.js";
import {toChainViewBlockBytes} from "./utils.js";

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
): Promise<ImportExecutionPayloadResult> {
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
): Promise<ImportExecutionPayloadResult> {
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

  // Timely inclusion lists of the preceding slot, keyed by that slot's dependent root on the block's branch and
  // resolved from the parent, which is at or before that slot. Gossip validation only accepts lists whose dependent
  // block is in fork choice, so a dependent root fork choice cannot resolve (below the anchor after checkpoint sync)
  // keys no stored list
  let inclusionListTransactions: bellatrix.Transactions | undefined;
  if (isStatePostHeze(blockState)) {
    const inclusionListSlot = protoBlock.slot - 1;
    let dependentRoot: RootHex | null = null;
    const parentBlock = this.forkChoice.getBlockHexDefaultStatus(protoBlock.parentRoot);
    if (parentBlock !== null) {
      try {
        dependentRoot = getShufflingDependentRoot(
          this.forkChoice,
          computeEpochAtSlot(inclusionListSlot),
          computeEpochAtSlot(parentBlock.slot),
          parentBlock
        );
      } catch (e) {
        this.logger.debug(
          "Inclusion list dependent root not in fork choice, importing payload without lists",
          {slot, root: blockRootHex},
          e as Error
        );
      }
    }
    inclusionListTransactions =
      dependentRoot === null
        ? SerializedList.empty()
        : this.inclusionListStore.getInclusionListTransactions(inclusionListSlot, dependentRoot, true);
  }

  const logCtx = {slot, root: blockRootHex, executionBlock: envelope.payload.blockNumber};
  this.logger.debug("Call engine api newPayload", logCtx);
  const verifyStartSec = Date.now() / 1000;
  const [execResult, signatureValid] = await Promise.all([
    this.executionEngine.notifyNewPayload(
      fork,
      envelope.payload,
      blockState.latestExecutionPayloadBid.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      envelope.parentBeaconBlockRoot,
      envelope.executionRequests,
      inclusionListTransactions
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

  // [beacon-engine] Core has no DA work to queue; BeaconChain queues column persistence.
  // In both modes, await the envelope write before marking the payload FULL so getParentExecutionRequests()
  // can read it from DB when slot preparation or production builds on it.
  await this.db.executionPayloadEnvelope.putBinary(blockRoot, envelopeBytes);

  // A VALID payload that does not satisfy the inclusion list constraints is still imported, fork choice
  // only records the verdict so should_extend_payload moves the head to the EMPTY variant, which the next
  // proposer builds on.
  // Recorded before the payload enters fork choice. A VALID response must carry a verdict, an
  // optimistically imported payload counts as satisfied until the engine validates it, anything else as
  // unsatisfied. A VALID response without a verdict violates the engine API, it is logged and treated as
  // satisfied so a non-compliant engine does not orphan every payload
  if (inclusionListTransactions !== undefined) {
    if (execResult.status === ExecutionPayloadStatus.VALID && execResult.inclusionListSatisfied == null) {
      this.logger.warn("Execution engine reported no inclusion list verdict, not enforcing inclusion lists", logCtx);
    }
    const satisfied =
      execResult.status === ExecutionPayloadStatus.VALID
        ? (execResult.inclusionListSatisfied ?? true)
        : execResult.status === ExecutionPayloadStatus.SYNCING || execResult.status === ExecutionPayloadStatus.ACCEPTED;
    this.forkChoice.recordPayloadInclusionListSatisfaction(blockRootHex, satisfied);
    if (!satisfied) {
      this.logger.verbose("Payload did not satisfy inclusion list constraints", {
        ...logCtx,
        blockHash: blockHashHex,
        status: execResult.status,
        inclusionListTransactions: inclusionListTransactions.length,
      });
    }
  }

  this.forkChoice.onExecutionPayload(
    blockRootHex,
    blockHashHex,
    envelope.payload.blockNumber,
    envelope.payload.gasLimit,
    execStatus,
    dataAvailabilityStatus
  );

  // Read retained metadata even if finalization advanced during asynchronous verification.
  const importedBlock = this.forkChoice.getBlockHexAndBlockHash(blockRootHex, blockHashHex);
  if (importedBlock === null || importedBlock.payloadStatus !== PayloadStatus.FULL) {
    throw new PayloadError({code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE, blockRootHex});
  }
  const result: ImportExecutionPayloadResult = {
    executionOptimistic: execStatus === ExecutionStatus.Syncing,
    block: toChainViewBlockBytes(importedBlock),
  };

  // Fire the FCU only when this payload's block is the canonical head.
  const head = this.forkChoice.getHead();
  if (
    !this.opts.disableImportExecutionFcU &&
    blockRootHex === head.blockRoot &&
    this.forkChoice.isPayloadInclusionListSatisfied(blockRootHex)
  ) {
    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice, this.logger);
    const finalizedBlockHash = getFinalizedExecutionBlockHash(this.forkChoice);
    this.executionEngine.notifyForkchoiceUpdate(fork, blockHashHex, safeBlockHash, finalizedBlockHash).catch((e) => {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.logger.error("Error pushing notifyForkchoiceUpdate()", {blockHashHex, finalizedBlockHash}, e);
      }
    });
  }

  return result;
}
