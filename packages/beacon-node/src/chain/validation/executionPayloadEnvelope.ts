import {PayloadStatus} from "@lodestar/fork-choice";
import {
  computeStartSlotAtEpoch,
  getExecutionPayloadEnvelopeSignatureSet,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {
  getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized,
  getSlotFromExecutionPayloadEnvelopeSerialized,
  getTransactionCountFromExecutionPayloadEnvelopeSerialized,
} from "../../util/sszBytes.js";
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

/**
 * Applies the transaction count check to the serialized envelope so that an oversized envelope is rejected
 * before it is deserialized. Defers to validateGossipExecutionPayloadEnvelope if the data is
 * malformed or an IGNORE rule that precedes the check in the spec applies.
 */
export function validateGossipExecutionPayloadEnvelopeSerialized(
  chain: IBeaconChain,
  serializedData: Uint8Array
): void {
  const blockRootHex = getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized(serializedData);
  const slot = getSlotFromExecutionPayloadEnvelopeSerialized(serializedData);
  const transactionCount = getTransactionCountFromExecutionPayloadEnvelopeSerialized(serializedData);
  if (blockRootHex === null || slot === null || transactionCount === null) {
    return;
  }

  const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);
  if (
    !payloadInput ||
    payloadInput.hasPayloadEnvelope() ||
    chain.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL) !== null ||
    chain.forkChoice.getBlockHexDefaultStatus(blockRootHex) === null
  ) {
    return;
  }

  const finalizedSlot = computeStartSlotAtEpoch(chain.forkChoice.getFinalizedCheckpoint().epoch);
  if (slot < finalizedSlot) {
    return;
  }

  const maxTransactionCount = payloadInput.getBid().gasLimit / BigInt(chain.config.MIN_TRANSACTION_GAS);
  if (BigInt(transactionCount) > maxTransactionCount) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_TRANSACTIONS,
      slot,
      root: blockRootHex,
      transactionCount,
      maxTransactionCount: Number(maxTransactionCount),
    });
  }
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

  // [REJECT] `len(payload.transactions) <= bid.gas_limit // MIN_TRANSACTION_GAS`
  const maxTransactionCount = payloadInput.getBid().gasLimit / BigInt(chain.config.MIN_TRANSACTION_GAS);
  if (BigInt(payload.transactions.length) > maxTransactionCount) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_TRANSACTIONS,
      slot: payload.slotNumber,
      root: blockRootHex,
      transactionCount: payload.transactions.length,
      maxTransactionCount: Number(maxTransactionCount),
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
    blockState,
    executionPayloadEnvelope,
    payloadInput.proposerIndex
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
      slot: payload.slotNumber,
      root: blockRootHex,
    });
  }
}
