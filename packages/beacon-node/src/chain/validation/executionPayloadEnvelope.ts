import {PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {
  MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD,
  MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD,
  MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
} from "@lodestar/params";
import {computeStartSlotAtEpoch, computeTimeAtSlot, isStatePostGloas} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {
  getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized,
  getSlotFromExecutionPayloadEnvelopeSerialized,
  getTransactionCountFromExecutionPayloadEnvelopeSerialized,
} from "../../util/sszBytes.js";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";

export async function validateApiExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.ExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
}

export async function validateGossipExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.ExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
}

/**
 * Applies the transaction count check to the serialized envelope so that an oversized envelope is dropped
 * before it is deserialized. Defers to validateGossipExecutionPayloadEnvelope if the data is malformed
 * or the block is not known.
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

  const block = chain.forkChoice.getBlockHexDefaultStatus(blockRootHex);
  const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);
  if (!block || !payloadInput) {
    return;
  }

  const maxTransactionCount = getMaxTransactionCount(chain, block, payloadInput);
  if (BigInt(transactionCount) > maxTransactionCount) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
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
  envelope: gloas.ExecutionPayloadEnvelope
): Promise<void> {
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

  // [IGNORE] The node has not seen another valid `ExecutionPayloadEnvelope` for this block root.
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
  // The envelope is not signed, every field must be checked against the block for the envelope to be unique.
  // `process_execution_payload_bid` asserts that `bid.parent_block_root` is the root of the latest block header,
  // which `process_block_header` asserts `block.parent_root` to be: the bid has the parent root of the block
  if (!byteArrayEquals(envelope.parentBeaconBlockRoot, payloadInput.getBid().parentBlockRoot)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_BEACON_BLOCK_ROOT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopeParentRoot: toRootHex(envelope.parentBeaconBlockRoot),
      blockParentRoot: toRootHex(payloadInput.getBid().parentBlockRoot),
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

  // [IGNORE] The number of transactions is within the limit implied by the parent payload's gas limit
  // TODO GLOAS: [REJECT] once https://github.com/ethereum/consensus-specs/pull/5802 is released,
  // also in validateGossipExecutionPayloadEnvelopeSerialized
  const maxTransactionCount = getMaxTransactionCount(chain, block, payloadInput);
  if (BigInt(payload.transactions.length) > maxTransactionCount) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_TRANSACTIONS,
      slot: payload.slotNumber,
      root: blockRootHex,
      transactionCount: payload.transactions.length,
      maxTransactionCount: Number(maxTransactionCount),
    });
  }

  // [REJECT] `hash_tree_root(payload) == bid.payload_root`
  const payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(payload);
  if (!byteArrayEquals(payloadRoot, payloadInput.getBid().payloadRoot)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      envelopePayloadRoot: toRootHex(payloadRoot),
      bidPayloadRoot: toRootHex(payloadInput.getBid().payloadRoot),
    });
  }

  // From here the envelope is the one the block commits to. The checks above have the order of the spec, the
  // remaining ones come after `hash_tree_root(payload) == bid.payload_root` so that an envelope that is not the
  // one of the block always fails a check that binds it to the block, whatever else is wrong with it
  const bid = payloadInput.getBid();

  // [REJECT] `payload.prev_randao == bid.prev_randao`
  if (!byteArrayEquals(payload.prevRandao, bid.prevRandao)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.PREV_RANDAO_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      actual: toHex(payload.prevRandao),
      expected: toHex(bid.prevRandao),
    });
  }

  // [REJECT] `payload.gas_limit == bid.gas_limit`
  if (BigInt(payload.gasLimit) !== bid.gasLimit) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.GAS_LIMIT_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      actual: payload.gasLimit,
      expected: Number(bid.gasLimit),
    });
  }

  // [REJECT] The execution request counts are within their limits, `verify_execution_requests_limits`
  const {executionRequests} = envelope;
  for (const [requestType, count, limit] of [
    ["withdrawals", executionRequests.withdrawals.length, MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD],
    ["consolidations", executionRequests.consolidations.length, MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD],
    ["builderDeposits", executionRequests.builderDeposits.length, MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD],
    ["builderExits", executionRequests.builderExits.length, MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD],
  ] as const) {
    if (count > limit) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_EXECUTION_REQUESTS,
        slot: payload.slotNumber,
        root: blockRootHex,
        requestType,
        count,
        limit,
      });
    }
  }

  // [REJECT] `len(payload.withdrawals) <= MAX_WITHDRAWALS_PER_PAYLOAD`
  if (payload.withdrawals.length > MAX_WITHDRAWALS_PER_PAYLOAD) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_WITHDRAWALS,
      slot: payload.slotNumber,
      root: blockRootHex,
      count: payload.withdrawals.length,
      limit: MAX_WITHDRAWALS_PER_PAYLOAD,
    });
  }

  // [REJECT] `payload.parent_hash == state.latest_block_hash`
  // `process_execution_payload_bid` asserts `bid.parent_block_hash == state.latest_block_hash` and nothing in the
  // block changes it afterwards, so the bid of the block has the value of the block's post-state
  if (!byteArrayEquals(payload.parentHash, bid.parentBlockHash)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_HASH_MISMATCH,
      slot: payload.slotNumber,
      root: blockRootHex,
      actual: toRootHex(payload.parentHash),
      expected: toRootHex(bid.parentBlockHash),
    });
  }

  // [REJECT] `payload.timestamp == compute_time_at_slot(state.genesis_time, block.slot)`
  const expectedTimestamp = computeTimeAtSlot(chain.config, block.slot, chain.genesisTime);
  if (payload.timestamp !== expectedTimestamp) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INCORRECT_TIMESTAMP,
      slot: payload.slotNumber,
      root: blockRootHex,
      actual: payload.timestamp,
      expected: expectedTimestamp,
    });
  }

  // [REJECT] The payload contains no empty transactions
  for (let index = 0; index < payload.transactions.length; index++) {
    if (payload.transactions.getSize(index) === 0) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.EMPTY_TRANSACTION,
        slot: payload.slotNumber,
        root: blockRootHex,
        index,
      });
    }
  }

  // [REJECT] `hash_tree_root(payload.withdrawals) == hash_tree_root(state.payload_expected_withdrawals)`
  // Only the block's post-state has the expected withdrawals. It is checked here if the state is still cached,
  // which is the case for a block that was just imported, a regen is too expensive for gossip validation.
  // The import of the payload checks it in any case, see `verifyExecutionPayloadEnvelope`
  const blockState = chain.regen.getStateSync(block.stateRoot);
  if (blockState && isStatePostGloas(blockState)) {
    const withdrawalsRoot = ssz.gloas.Withdrawals.hashTreeRoot(payload.withdrawals);
    const expectedWithdrawalsRoot = ssz.gloas.Withdrawals.hashTreeRoot(blockState.payloadExpectedWithdrawals);
    if (!byteArrayEquals(withdrawalsRoot, expectedWithdrawalsRoot)) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.WITHDRAWALS_MISMATCH,
        slot: payload.slotNumber,
        root: blockRootHex,
        actual: toRootHex(withdrawalsRoot),
        expected: toRootHex(expectedWithdrawalsRoot),
      });
    }
  }
}

/**
 * The bid's gas limit is only tied to the parent payload by bid gossip, so the bound is the gas limit the
 * EIP-1559 rule allows on top of the parent payload's. The bid is the only bound if that gas limit is unknown.
 */
function getMaxTransactionCount(chain: IBeaconChain, block: ProtoBlock, payloadInput: PayloadEnvelopeInput): bigint {
  const parentGasLimit = block.executionPayloadBlockHash === null ? 0n : BigInt(block.executionPayloadGasLimit);
  const maxGasLimit =
    parentGasLimit === 0n
      ? payloadInput.getBid().gasLimit
      : parentGasLimit + (parentGasLimit / 1024n > 1n ? parentGasLimit / 1024n : 1n) - 1n;
  return maxGasLimit / BigInt(chain.config.MIN_TRANSACTION_GAS);
}
