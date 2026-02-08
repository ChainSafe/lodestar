import {FAR_FUTURE_EPOCH, ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {BLSPubkey, Bytes32, UintNum64, electra, ssz} from "@lodestar/types";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {findBuilderIndexByPubkey, isBuilderWithdrawalCredential} from "../util/gloas.js";
import {computeEpochAtSlot, isValidatorKnown} from "../util/index.js";
import {isValidDepositSignature} from "./processDeposit.js";

/**
 * Apply a deposit for a builder. Either increases balance for existing builder or adds new builder to registry.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-apply_deposit_for_builder
 */
export function applyDepositForBuilder(
  state: CachedBeaconStateGloas,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64,
  signature: Bytes32
): void {
  const builderIndex = findBuilderIndexByPubkey(state, pubkey);

  if (builderIndex !== null) {
    // Existing builder - increase balance
    const builder = state.builders.get(builderIndex);
    builder.balance += amount;
  } else {
    // New builder - verify signature and add to registry
    if (isValidDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      addBuilderToRegistry(state, pubkey, withdrawalCredentials, amount);
    }
  }
}

/**
 * Add a new builder to the builders registry.
 * Reuses slots from exited and fully withdrawn builders if available.
 */
function addBuilderToRegistry(
  state: CachedBeaconStateGloas,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64
): void {
  const currentEpoch = computeEpochAtSlot(state.slot);

  // Try to find a reusable slot from an exited builder with zero balance
  let builderIndex = state.builders.length;
  for (let i = 0; i < state.builders.length; i++) {
    const builder = state.builders.getReadonly(i);
    if (builder.withdrawableEpoch <= currentEpoch && builder.balance === 0) {
      builderIndex = i;
      break;
    }
  }

  // Create new builder
  const newBuilder = ssz.gloas.Builder.toViewDU({
    pubkey,
    version: withdrawalCredentials[0],
    executionAddress: withdrawalCredentials.subarray(12),
    balance: amount,
    depositEpoch: currentEpoch,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
  });

  if (builderIndex < state.builders.length) {
    // Reuse existing slot
    state.builders.set(builderIndex, newBuilder);
  } else {
    // Append to end
    state.builders.push(newBuilder);
  }
}

export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  depositRequest: electra.DepositRequest
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  // Check if this is a builder or validator deposit
  if (fork >= ForkSeq.gloas) {
    const stateGloas = state as CachedBeaconStateGloas;
    const builderIndex = findBuilderIndexByPubkey(stateGloas, pubkey);
    const validatorIndex = state.epochCtx.getValidatorIndex(pubkey);

    // Regardless of the withdrawal credentials prefix, if a builder/validator
    // already exists with this pubkey, apply the deposit to their balance
    const isBuilder = builderIndex !== null;
    const isValidator = isValidatorKnown(state, validatorIndex);
    const isBuilderPrefix = isBuilderWithdrawalCredential(withdrawalCredentials);

    // Route to builder if it's an existing builder OR has builder prefix and is not a validator
    if (isBuilder || (isBuilderPrefix && !isValidator)) {
      // Apply builder deposits immediately
      applyDepositForBuilder(stateGloas, pubkey, withdrawalCredentials, amount, signature);
      return;
    }
  }

  // Only set deposit_requests_start_index in Electra fork, not Gloas
  if (fork < ForkSeq.gloas && state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    state.depositRequestsStartIndex = depositRequest.index;
  }

  // Add validator deposits to the queue
  const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
    pubkey,
    withdrawalCredentials,
    amount,
    signature,
    slot: state.slot,
  });
  state.pendingDeposits.push(pendingDeposit);
}
