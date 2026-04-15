import {ForkPostGloas, SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {BeaconBlock, electra, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {CachedBeaconStateGloas} from "../types.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {processConsolidationRequest} from "./processConsolidationRequest.js";
import {getPendingValidatorPubkeys, processDepositRequest} from "./processDepositRequest.js";
import {processWithdrawalRequest} from "./processWithdrawalRequest.js";

/**
 * Process parent execution payload effects as first step of processBlock.
 *
 * Spec: consensus-specs#5094
 * https://github.com/ethereum/consensus-specs/blob/26ed32e/specs/gloas/beacon-chain.md
 */
export function processParentExecutionPayload(
  state: CachedBeaconStateGloas,
  block: BeaconBlock<ForkPostGloas>
): void {
  const bid = block.body.signedExecutionPayloadBid.message;
  const parentBid = state.latestExecutionPayloadBid;
  const requests = block.body.parentExecutionRequests;

  // True if this block built on the parent's full payload
  const isParentFull = byteArrayEquals(bid.parentBlockHash, parentBid.blockHash);

  if (!isParentFull) {
    // Parent was EMPTY -- no execution requests expected
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

  applyParentExecutionPayload(state, parentBid, requests);
}

/**
 * Apply parent execution payload effects to state.
 *
 * Spec: apply_parent_execution_payload
 */
function applyParentExecutionPayload(
  state: CachedBeaconStateGloas,
  parentBid: {slot: number; blockHash: Uint8Array; builderIndex: number},
  requests: electra.ExecutionRequests
): void {
  const fork = state.config.getForkSeq(state.slot);
  const parentSlot = parentBid.slot;
  const parentEpoch = computeEpochAtSlot(parentSlot);
  const currentEpoch = computeEpochAtSlot(state.slot);

  // Process execution requests from parent's payload
  // Execution requests are processed at state.slot (child's slot), not parent's slot
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

  // Queue the builder payment
  let paymentIndex: number | null;
  if (parentEpoch === currentEpoch) {
    paymentIndex = SLOTS_PER_EPOCH + (parentSlot % SLOTS_PER_EPOCH);
  } else if (parentEpoch === currentEpoch - 1) {
    paymentIndex = parentSlot % SLOTS_PER_EPOCH;
  } else {
    // Parent is older than previous epoch — payment already settled/evicted
    paymentIndex = null;
  }

  if (paymentIndex !== null) {
    const payment = state.builderPendingPayments.get(paymentIndex).clone();
    if (payment.withdrawal.amount > 0) {
      state.builderPendingWithdrawals.push(payment.withdrawal);
    }
    state.builderPendingPayments.set(paymentIndex, ssz.gloas.BuilderPendingPayment.defaultViewDU());
  }

  // Update parent payload availability and latest block hash
  state.executionPayloadAvailability.set(parentSlot % SLOTS_PER_HISTORICAL_ROOT, true);
  state.latestBlockHash = parentBid.blockHash;
}

function assertEmptyExecutionRequests(requests: electra.ExecutionRequests): void {
  if (requests.deposits.length !== 0 || requests.withdrawals.length !== 0 || requests.consolidations.length !== 0) {
    throw new Error("Parent execution requests must be empty when parent block is EMPTY");
  }
}
