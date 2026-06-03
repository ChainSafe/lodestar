import {FAR_FUTURE_EPOCH, ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {BLSPubkey, Bytes32, UintNum64, electra, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {findBuilderIndexByPubkey, isBuilderWithdrawalCredential} from "../util/gloas.js";
import {computeEpochAtSlot, isValidatorKnown} from "../util/index.js";
import {PendingDepositsLookup} from "../util/pendingDepositsLookup.js";
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
  signature: Bytes32,
  slot: UintNum64
): void {
  const builderIndex = findBuilderIndexByPubkey(state, pubkey);

  if (builderIndex !== null) {
    // Existing builder - increase balance
    const builder = state.builders.get(builderIndex);
    builder.balance += amount;
  } else {
    // New builder - verify signature and add to registry
    if (isValidDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      addBuilderToRegistry(state, pubkey, withdrawalCredentials, amount, slot);
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
  amount: UintNum64,
  slot: UintNum64
): void {
  const currentEpoch = computeEpochAtSlot(state.slot);
  const depositEpoch = computeEpochAtSlot(slot);

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
    depositEpoch: depositEpoch,
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

// TODO GLOAS: the PendingDepositsLookup is currently scoped to a single envelope of
// deposit-requests. We can track it as ephemeral within EpochCache and transfer to the next block
// transition to reuse cached signature verifications.
// See https://github.com/ChainSafe/lodestar/issues/9181
export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  depositRequest: electra.DepositRequest,
  pendingDepositsLookup?: PendingDepositsLookup
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  if (fork >= ForkSeq.gloas) {
    const stateGloas = state as CachedBeaconStateGloas;
    const lookup = pendingDepositsLookup ?? PendingDepositsLookup.build(stateGloas);
    const pubkeyHex = toPubkeyHex(pubkey);
    const builderIndex = findBuilderIndexByPubkey(stateGloas, pubkey);
    const validatorIndex = state.epochCtx.getValidatorIndex(pubkey);

    const isBuilder = builderIndex !== null;
    const isValidator = isValidatorKnown(state, validatorIndex);

    if (isBuilder) {
      // Top up an existing builder regardless of withdrawal credential prefix
      applyDepositForBuilder(stateGloas, pubkey, withdrawalCredentials, amount, signature, state.slot);
      return;
    }

    // Only check the (expensive) "pending validator" condition when needed
    if (
      isBuilderWithdrawalCredential(withdrawalCredentials) &&
      !isValidator &&
      !lookup.hasPendingValidator(state.config, pubkeyHex)
    ) {
      applyDepositForBuilder(stateGloas, pubkey, withdrawalCredentials, amount, signature, state.slot);
      return;
    }

    const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
      pubkey,
      withdrawalCredentials,
      amount,
      signature,
      slot: state.slot,
    });
    // Keep the lookup in sync with state.pendingDeposits so later deposit-requests
    // in the same envelope see this deposit
    lookup.add(pendingDeposit, pubkeyHex);
    state.pendingDeposits.push(pendingDeposit);
    return;
  }

  // Pre-Gloas (Electra) path
  // [Modified in Fulu:EIP6110] The Fulu version of `process_deposit_request` no longer
  // initializes `deposit_requests_start_index` since the legacy eth1 bridge is gone.
  if (fork < ForkSeq.fulu && state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
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
