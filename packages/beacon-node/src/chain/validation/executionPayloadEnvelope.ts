import {PayloadStatus} from "@lodestar/fork-choice";
import {isForkPostGloas} from "@lodestar/params";
import {
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  getExecutionPayloadEnvelopeSignatureSet,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {computeExecutionBlockHash} from "../../execution/engine/blockHash.js";
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
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeSlot: payload.slotNumber,
      blockSlot: block.slot,
    });
  }

  // [REJECT] `envelope.parent_beacon_block_root == block.parent_root`
  const envelopeParentRoot = toRootHex(envelope.parentBeaconBlockRoot);
  if (envelopeParentRoot !== block.parentRoot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_BEACON_BLOCK_ROOT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeParentRoot,
      blockParentRoot: block.parentRoot,
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

  const bid = payloadInput.getBid();

  // [REJECT] `payload.prev_randao == bid.prev_randao`
  if (!byteArrayEquals(payload.prevRandao, bid.prevRandao)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.PREV_RANDAO_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      payloadPrevRandao: toHex(payload.prevRandao),
      bidPrevRandao: toHex(bid.prevRandao),
    });
  }

  // [REJECT] `payload.gas_limit == bid.gas_limit`
  if (BigInt(payload.gasLimit) !== bid.gasLimit) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.GAS_LIMIT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      payloadGasLimit: payload.gasLimit,
      bidGasLimit: bid.gasLimit,
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
  if (!byteArrayEquals(requestsRoot, bid.executionRequestsRoot)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeRequestsRoot: toRootHex(requestsRoot),
      bidRequestsRoot: toRootHex(bid.executionRequestsRoot),
    });
  }

  // Execution request and withdrawal count limits are enforced by the SSZ list limits on decode

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

  // [REJECT] `payload.parent_hash == state.latest_block_hash`
  if (!byteArrayEquals(payload.parentHash, blockState.latestBlockHash)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_HASH_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      payloadParentHash: toRootHex(payload.parentHash),
      latestBlockHash: toRootHex(blockState.latestBlockHash),
    });
  }

  // [REJECT] `payload.timestamp == compute_time_at_slot(state.genesis_time, block.slot)`
  const expectedTimestamp = computeTimeAtSlot(chain.config, block.slot, blockState.genesisTime);
  if (payload.timestamp !== expectedTimestamp) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_TIMESTAMP,
      slot: payload.slotNumber,
      root: blockRootHex,
      payloadTimestamp: payload.timestamp,
      expectedTimestamp,
    });
  }

  // [REJECT] `hash_tree_root(payload.withdrawals) == hash_tree_root(state.payload_expected_withdrawals)`
  const payloadWithdrawalsRoot = ssz.gloas.Withdrawals.hashTreeRoot(payload.withdrawals);
  const expectedWithdrawalsRoot = ssz.gloas.Withdrawals.hashTreeRoot(blockState.payloadExpectedWithdrawals);
  if (!byteArrayEquals(payloadWithdrawalsRoot, expectedWithdrawalsRoot)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.WITHDRAWALS_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      payloadWithdrawalsRoot: toRootHex(payloadWithdrawalsRoot),
      expectedWithdrawalsRoot: toRootHex(expectedWithdrawalsRoot),
    });
  }

  // An empty transaction is a deletion in the transactions trie, so trailing empty transactions would not change
  // the block hash. The EL rejects such a payload, as `verify_and_notify_new_payload` does before hashing.
  for (let i = 0; i < payload.transactions.length; i++) {
    if (payload.transactions.getSize(i) === 0) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.ZERO_LENGTH_TRANSACTION,
        slot: payload.slotNumber,
        root: blockRootHex,
        index: i,
      });
    }
  }

  // [REJECT] The payload's block hash is computed correctly
  const fork = chain.config.getForkName(block.slot);
  if (!isForkPostGloas(fork)) {
    throw new Error(`Expected gloas+ fork for execution payload envelope validation, got fork=${fork}`);
  }
  const timer = chain.metrics?.gossipExecutionPayloadEnvelope.blockHashTime.startTimer();
  const computedBlockHash = computeExecutionBlockHash(
    fork,
    payload,
    envelope.parentBeaconBlockRoot,
    envelope.executionRequests
  );
  timer?.();
  if (!byteArrayEquals(computedBlockHash, payload.blockHash)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK_HASH,
      slot: payload.slotNumber,
      root: blockRootHex,
      blockHash: toRootHex(payload.blockHash),
      computedBlockHash: toRootHex(computedBlockHash),
    });
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
