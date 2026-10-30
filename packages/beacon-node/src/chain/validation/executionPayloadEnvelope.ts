import {PayloadStatus} from "@lodestar/fork-choice";
import {
  computeStartSlotAtEpoch,
  getExecutionPayloadEnvelopeSignatureSet,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import type {BeaconEngineCore} from "../beaconEngine/beaconEngineCore.js";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";

export async function validateApiExecutionPayloadEnvelope(
  this: BeaconEngineCore,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope.call(this, executionPayloadEnvelope);
}

export async function validateGossipExecutionPayloadEnvelope(
  this: BeaconEngineCore,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope.call(this, executionPayloadEnvelope);
}

async function validateExecutionPayloadEnvelope(
  this: BeaconEngineCore,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  const envelope = executionPayloadEnvelope.message;
  const {payload} = envelope;
  const blockRootHex = toRootHex(envelope.beaconBlockRoot);

  // [IGNORE] The envelope's block root `envelope.beacon_block_root` has been seen (via
  // gossip or non-gossip sources) (a client MAY queue payload for processing once
  // the block is retrieved).
  const block = this.forkChoice.getBlockDefaultStatus(envelope.beaconBlockRoot);
  if (block === null) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
      blockRoot: blockRootHex,
    });
  }

  // [IGNORE] The node has not seen another valid
  // `SignedExecutionPayloadEnvelope` for this block root from this builder.
  const envelopeBlock = this.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL);

  // [beacon-engine] deviation: cached validation does not suppress gossip until import marks the payload FULL.
  if (envelopeBlock) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
      blockRoot: blockRootHex,
      slot: payload.slotNumber,
    });
  }

  const payloadInput =
    this.seenPayloadEnvelopeInputCache.get(blockRootHex) ??
    (await this.seenPayloadEnvelopeInputCache.getOrReload(blockRootHex));
  if (!payloadInput) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING,
      blockRoot: blockRootHex,
    });
  }

  // [IGNORE] The envelope is from a slot greater than or equal to the latest finalized slot -- i.e. validate that `payload.slotNumber >= compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)`
  const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (payload.slotNumber < finalizedSlot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BELONG_TO_FINALIZED_BLOCK,
      envelopeSlot: payload.slotNumber,
      finalizedSlot,
    });
  }

  // [REJECT] `block` passes validation.
  // TODO GLOAS: implement this. Technically if we cannot get proto block from fork choice,
  // it is possible that the block didn't pass the validation

  // [REJECT] `block.slot` equals `payload.slotNumber`.
  if (block.slot !== payload.slotNumber) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeSlot: payload.slotNumber,
      blockSlot: block.slot,
    });
  }

  // [REJECT] `envelope.builder_index == bid.builder_index`
  if (envelope.builderIndex !== payloadInput.getBuilderIndex()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeBuilderIndex: envelope.builderIndex,
      bidBuilderIndex: payloadInput.getBuilderIndex(),
    });
  }

  // [REJECT] `payload.block_hash == bid.block_hash`
  if (toRootHex(payload.blockHash) !== payloadInput.getBlockHashHex()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeBlockHash: toRootHex(payload.blockHash),
      bidBlockHash: payloadInput.getBlockHashHex(),
    });
  }

  // [REJECT] `hash_tree_root(envelope.execution_requests) == bid.execution_requests_root`
  const requestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
  if (!byteArrayEquals(requestsRoot, payloadInput.getBid().executionRequestsRoot)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeRequestsRoot: toRootHex(requestsRoot),
      bidRequestsRoot: toRootHex(payloadInput.getBid().executionRequestsRoot),
    });
  }

  // Get the block state to verify the builder's signature.
  const blockState = await this.regen.getState(block.stateRoot, RegenCaller.validateGossipPayloadEnvelope).catch(() => {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.UNKNOWN_BLOCK_STATE,
      blockRoot: blockRootHex,
      slot: payload.slotNumber,
    });
  });
  if (!isStatePostGloas(blockState)) {
    throw new Error(`Expected gloas+ state for execution payload envelope validation, got fork=${blockState.forkName}`);
  }

  // [REJECT] `signed_execution_payload_envelope.signature` is valid as verified
  // by `verify_execution_payload_envelope_signature`.
  const signatureSet = getExecutionPayloadEnvelopeSignatureSet(
    this.config,
    blockState,
    executionPayloadEnvelope,
    payloadInput.proposerIndex
  );

  if (!(await this.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
      slot: payload.slotNumber,
      root: blockRootHex,
    });
  }
}
