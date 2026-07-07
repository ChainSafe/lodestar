import {PayloadStatus} from "@lodestar/fork-choice";
import {
  MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD,
  MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD,
  MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
} from "@lodestar/params";
import {
  computeStartSlotAtEpoch,
  getExecutionPayloadEnvelopeSignatureSet,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";

export async function validateApiExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
}

export async function validateGossipExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
}

async function validateExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  const envelope = executionPayloadEnvelope.message;
  const {payload} = envelope;
  const blockRootHex = toRootHex(envelope.beaconBlockRoot);

  // [IGNORE] The envelope's block root `envelope.beacon_block_root` has been seen (via
  // gossip or non-gossip sources) (a client MAY queue payload for processing once
  // the block is retrieved).
  const block = chain.forkChoice.getBlockDefaultStatus(envelope.beaconBlockRoot);
  if (block === null) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
      blockRoot: blockRootHex,
    });
  }

  // [IGNORE] The node has not seen another valid
  // `SignedExecutionPayloadEnvelope` for this block root from this builder.
  const envelopeBlock = chain.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL);
  const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);
  if (envelopeBlock || payloadInput?.hasPayloadEnvelope()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
      blockRoot: blockRootHex,
      slot: payload.slotNumber,
    });
  }

  if (!payloadInput) {
    // PayloadEnvelopeInput should have been created during block import
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING,
      blockRoot: blockRootHex,
    });
  }

  // [IGNORE] The envelope is from a slot greater than or equal to the latest finalized slot -- i.e. validate that `payload.slotNumber >= compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)`
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
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
  if (envelope.builderIndex !== payloadInput.getBuilderIndex()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      envelopeBuilderIndex: envelope.builderIndex,
      bidBuilderIndex: payloadInput.getBuilderIndex(),
    });
  }

  // [REJECT] `payload.block_hash == bid.block_hash`
  if (toRootHex(payload.blockHash) !== payloadInput.getBlockHashHex()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      envelopeBlockHash: toRootHex(payload.blockHash),
      bidBlockHash: payloadInput.getBlockHashHex(),
    });
  }

  // [REJECT] `hash_tree_root(envelope.execution_requests) == bid.execution_requests_root`
  const requestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
  if (!byteArrayEquals(requestsRoot, payloadInput.getBid().executionRequestsRoot)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH,
      envelopeRequestsRoot: toRootHex(requestsRoot),
      bidRequestsRoot: toRootHex(payloadInput.getBid().executionRequestsRoot),
    });
  }

  // [REJECT] The non-deposit counts of `execution_requests` are within their respective limits.
  // New in Gloas:EIP7688 — progressive lists are unbounded at the type level, so bounds
  // are enforced here in gossip validation.
  const {executionRequests} = envelope;
  const requestCountLimits: [string, number, number][] = [
    ["withdrawals", executionRequests.withdrawals.length, MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD],
    ["consolidations", executionRequests.consolidations.length, MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD],
    ["builderDeposits", executionRequests.builderDeposits.length, MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD],
    ["builderExits", executionRequests.builderExits.length, MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD],
  ];
  for (const [name, count, limit] of requestCountLimits) {
    if (count > limit) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_COUNT_EXCEEDED,
        name,
        count,
        limit,
      });
    }
  }

  // [REJECT] The number of withdrawals is within the limit.
  if (payload.withdrawals.length > MAX_WITHDRAWALS_PER_PAYLOAD) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.WITHDRAWALS_COUNT_EXCEEDED,
      count: payload.withdrawals.length,
      limit: MAX_WITHDRAWALS_PER_PAYLOAD,
    });
  }

  // Get the block state to verify the builder's signature.
  const blockState = await chain.regen
    .getState(block.stateRoot, RegenCaller.validateGossipPayloadEnvelope)
    .catch(() => {
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
    chain.config,
    chain.pubkeyCache,
    blockState,
    executionPayloadEnvelope,
    payloadInput.proposerIndex
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
    });
  }
}
