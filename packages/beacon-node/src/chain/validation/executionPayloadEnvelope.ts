import {PayloadStatus} from "@lodestar/fork-choice";
import {
  computeStartSlotAtEpoch,
  getExecutionPayloadEnvelopeSignatureSet,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {Root, RootHex, ValidatorIndex, gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import type {BeaconEngine} from "../beaconEngine/beaconEngine.js";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";

// The `bid*` / `proposerIndex` values are read facade-side from the `PayloadEnvelopeInput` (owned by
// BeaconChain) and passed in as scalars — the engine no longer touches the DA seen cache.
export async function validateApiExecutionPayloadEnvelope(
  this: BeaconEngine,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: ValidatorIndex,
  bidBuilderIndex: ValidatorIndex,
  bidBlockHashHex: RootHex,
  bidExecutionRequestsRoot: Root
): Promise<void> {
  return validateExecutionPayloadEnvelope.call(
    this,
    executionPayloadEnvelope,
    proposerIndex,
    bidBuilderIndex,
    bidBlockHashHex,
    bidExecutionRequestsRoot
  );
}

export async function validateGossipExecutionPayloadEnvelope(
  this: BeaconEngine,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: ValidatorIndex,
  bidBuilderIndex: ValidatorIndex,
  bidBlockHashHex: RootHex,
  bidExecutionRequestsRoot: Root
): Promise<void> {
  return validateExecutionPayloadEnvelope.call(
    this,
    executionPayloadEnvelope,
    proposerIndex,
    bidBuilderIndex,
    bidBlockHashHex,
    bidExecutionRequestsRoot
  );
}

async function validateExecutionPayloadEnvelope(
  this: BeaconEngine,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: ValidatorIndex,
  bidBuilderIndex: ValidatorIndex,
  bidBlockHashHex: RootHex,
  bidExecutionRequestsRoot: Root
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

  // const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
  // if (envelopeBlock || payloadInput?.hasPayloadEnvelope()) {
  // TODO - beacon engine: unstable also check seenPayloadEnvelopeInputCache but we should not do it
  // see also https://github.com/ethereum/consensus-specs/pull/5355
  if (envelopeBlock) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
      blockRoot: blockRootHex,
      slot: payload.slotNumber,
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
      envelopeSlot: payload.slotNumber,
      blockSlot: block.slot,
    });
  }

  // [REJECT] `envelope.builder_index == bid.builder_index`
  if (envelope.builderIndex !== bidBuilderIndex) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      envelopeBuilderIndex: envelope.builderIndex,
      bidBuilderIndex,
    });
  }

  // [REJECT] `payload.block_hash == bid.block_hash`
  if (toRootHex(payload.blockHash) !== bidBlockHashHex) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      envelopeBlockHash: toRootHex(payload.blockHash),
      bidBlockHash: bidBlockHashHex,
    });
  }

  // [REJECT] `hash_tree_root(envelope.execution_requests) == bid.execution_requests_root`
  const requestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
  if (!byteArrayEquals(requestsRoot, bidExecutionRequestsRoot)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH,
      envelopeRequestsRoot: toRootHex(requestsRoot),
      bidRequestsRoot: toRootHex(bidExecutionRequestsRoot),
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
    this.pubkeyCache,
    blockState,
    executionPayloadEnvelope,
    proposerIndex
  );

  if (!(await this.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
    });
  }
}
