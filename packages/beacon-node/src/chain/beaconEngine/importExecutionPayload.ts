import {ExecutionStatus, PayloadExecutionStatus, getSafeExecutionBlockHash} from "@lodestar/fork-choice";
import {DataAvailabilityStatus, isStatePostGloas} from "@lodestar/state-transition";
import {Root, RootHex, ValidatorIndex, gloas} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {PayloadError, PayloadErrorCode} from "../blocks/payloadError.js";
import {
  verifyExecutionPayloadEnvelope as verifyExecutionPayloadEnvelopeFields,
  verifyExecutionPayloadEnvelopeSignature,
} from "../blocks/verifyExecutionPayloadEnvelope.js";
import {RegenCaller} from "../regen/index.js";
import {BeaconEngine} from "./beaconEngine.js";

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/blocks/importExecutionPayload.ts#importExecutionPayload.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function verifyExecutionPayloadEnvelope(
  this: BeaconEngine,
  // [beacon-engine] deviation: bytes/POJO entry replaces the upstream payload-input object.
  _envelopeBytes: Uint8Array,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: ValidatorIndex,
  opts: {validSignature: boolean}
): Promise<void> {
  // [beacon-engine] deviation: facade handles EL, DA, persistence and events; this function verifies consensus.
  const envelope = signedEnvelope.message;
  const blockRootHex = toRootHex(envelope.beaconBlockRoot);

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
    verifyExecutionPayloadEnvelopeFields(this.config, blockState, envelope, {
      verifyExecutionRequestsRoot: !opts.validSignature,
    });
  } catch (e) {
    throw new PayloadError(
      {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: (e as Error).message},
      `Envelope verification error: ${(e as Error).message}`
    );
  }

  // [beacon-engine] deviation: facade runs newPayload in parallel with this consensus-only signature check.
  if (opts.validSignature !== true) {
    const signatureValid = await verifyExecutionPayloadEnvelopeSignature(
      this.config,
      blockState,
      this.pubkeyCache,
      signedEnvelope,
      proposerIndex,
      this.bls
    );
    if (!signatureValid) {
      throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
    }
  }
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/blocks/importExecutionPayload.ts#importExecutionPayload.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function importExecutionPayload(
  this: BeaconEngine,
  // [beacon-engine] deviation: receive the verified payload fields and mapped EL/DA statuses.
  blockRoot: Root,
  blockHashHex: RootHex,
  payloadBlockNumber: number,
  payloadGasLimit: number,
  execStatus: PayloadExecutionStatus,
  dataAvailabilityStatus: DataAvailabilityStatus
): {executionOptimistic: boolean} {
  // [beacon-engine] deviation: only fork-choice import and FCU run here; facade owns the envelope pipeline.
  const blockRootHex = toRootHex(blockRoot);

  this.forkChoice.onExecutionPayload(
    blockRootHex,
    blockHashHex,
    payloadBlockNumber,
    payloadGasLimit,
    execStatus,
    dataAvailabilityStatus
  );

  // Fire the FCU only when this payload's block is the canonical head.
  const head = this.forkChoice.getHead();
  if (!this.opts.disableImportExecutionFcU && blockRootHex === head.blockRoot) {
    // [beacon-engine] deviation: derive the fork from the canonical head instead of payloadInput.
    const fork = this.config.getForkName(head.slot);
    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice);
    const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    this.executionEngine.notifyForkchoiceUpdate(fork, blockHashHex, safeBlockHash, finalizedBlockHash).catch((e) => {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.logger.error("Error pushing notifyForkchoiceUpdate()", {blockHashHex, finalizedBlockHash}, e);
      }
    });
  }

  // [beacon-engine] deviation: return event optimism to the facade.
  return {executionOptimistic: execStatus === ExecutionStatus.Syncing};
}
