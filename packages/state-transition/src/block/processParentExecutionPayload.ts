import {ForkPostGloas, SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT, ZERO_HASH} from "@lodestar/params";
import {BeaconBlock, electra, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {CachedBeaconStateGloas} from "../types.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {processConsolidationRequest} from "./processConsolidationRequest.js";
import {getPendingValidatorPubkeys, processDepositRequest} from "./processDepositRequest.js";
import {processWithdrawalRequest} from "./processWithdrawalRequest.js";

/**
 * Process parent execution payload effects as the first step of processBlock.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.5/specs/gloas/beacon-chain.md#new-process_parent_execution_payload
 */
export function processParentExecutionPayload(state: CachedBeaconStateGloas, block: BeaconBlock<ForkPostGloas>): void {
  const bid = block.body.signedExecutionPayloadBid.message;
  const parentBid = state.latestExecutionPayloadBid;
  const requests = block.body.parentExecutionRequests;

  // Spec: is_genesis_block — parent bid has zero block_hash when the parent is the genesis block.
  // Genesis never had a real payload, so skip parent payload processing entirely.
  const isGenesisBlock = byteArrayEquals(parentBid.blockHash, ZERO_HASH);
  const isParentBlockEmpty = !byteArrayEquals(bid.parentBlockHash, parentBid.blockHash);
  if (isGenesisBlock || isParentBlockEmpty) {
    // Parent was genesis or EMPTY -- no execution requests expected
    assertEmptyExecutionRequests(requests);
    return;
  }

  // Parent was FULL -- verify the bid commitment and apply the payload
  const requestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(requests);
  if (!byteArrayEquals(requestsRoot, parentBid.executionRequestsRoot)) {
    throw new Error(
      `Parent execution requests root mismatch actual=${toRootHex(requestsRoot)} expected=${toRootHex(parentBid.executionRequestsRoot)}`
    );
  }

  applyParentExecutionPayload(state, requests);
}

/**
 * Process the parent's execution requests, queue the builder payment, update payload availability,
 * and update the latest block hash.
 *
 * Called from processParentExecutionPayload during block processing, and from the validator during
 * block production before computing withdrawals.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.5/specs/gloas/beacon-chain.md#new-apply_parent_execution_payload
 */
export function applyParentExecutionPayload(state: CachedBeaconStateGloas, requests: electra.ExecutionRequests): void {
  const fork = state.config.getForkSeq(state.slot);
  const parentBid = state.latestExecutionPayloadBid;
  const parentSlot = parentBid.slot;
  const parentEpoch = computeEpochAtSlot(parentSlot);
  const currentEpoch = computeEpochAtSlot(state.slot);

  // Process execution requests from parent's payload. The execution
  // requests are processed at state.slot (child's slot), not the parent's slot.
  if (requests.deposits.length > 0) {
    const pendingValidatorPubkeys = getPendingValidatorPubkeys(state.config, state);
    for (const deposit of requests.deposits) {
      processDepositRequest(fork, state, deposit, pendingValidatorPubkeys);
    }
  }

  for (const withdrawal of requests.withdrawals) {
    processWithdrawalRequest(fork, state, withdrawal);
  }

  for (const consolidation of requests.consolidations) {
    processConsolidationRequest(state, consolidation);
  }

  // Settle the builder payment
  if (parentEpoch === currentEpoch) {
    settleBuilderPayment(state, SLOTS_PER_EPOCH + (parentSlot % SLOTS_PER_EPOCH));
  } else if (parentEpoch === currentEpoch - 1) {
    settleBuilderPayment(state, parentSlot % SLOTS_PER_EPOCH);
  } else if (parentBid.value > 0) {
    // Parent is older than the previous epoch, its payment entry has been evicted from
    // builder_pending_payments. Append the withdrawal directly.
    state.builderPendingWithdrawals.push(
      ssz.gloas.BuilderPendingWithdrawal.toViewDU({
        feeRecipient: parentBid.feeRecipient,
        amount: parentBid.value,
        builderIndex: parentBid.builderIndex,
      })
    );
  }

  // Update parent payload availability and latest block hash
  state.executionPayloadAvailability.set(parentSlot % SLOTS_PER_HISTORICAL_ROOT, true);
  state.latestBlockHash = parentBid.blockHash;
}

/**
 * Settle a builder payment at the given index: move its withdrawal (if any) to the
 * pending withdrawals list and clear the payment slot.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.5/specs/gloas/beacon-chain.md#new-settle_builder_payment
 */
function settleBuilderPayment(state: CachedBeaconStateGloas, paymentIndex: number): void {
  if (paymentIndex >= state.builderPendingPayments.length) {
    throw new Error(
      `Invalid builder payment index paymentIndex=${paymentIndex} limit=${state.builderPendingPayments.length}`
    );
  }
  const payment = state.builderPendingPayments.get(paymentIndex).clone();
  if (payment.withdrawal.amount > 0) {
    state.builderPendingWithdrawals.push(payment.withdrawal);
  }
  state.builderPendingPayments.set(paymentIndex, ssz.gloas.BuilderPendingPayment.defaultViewDU());
}

function assertEmptyExecutionRequests(requests: electra.ExecutionRequests): void {
  if (requests.deposits.length !== 0 || requests.withdrawals.length !== 0 || requests.consolidations.length !== 0) {
    throw new Error("Parent execution requests must be empty when parent block is EMPTY");
  }
}
