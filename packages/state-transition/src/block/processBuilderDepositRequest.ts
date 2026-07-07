import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {gloas} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {
  addBuilderToRegistry,
  findBuilderIndexByPubkey,
  hasBuilderWithdrawalCredentialPrefix,
  isValidBuilderDepositSignature,
} from "../util/gloas.js";

/**
 * Process a builder deposit request from the execution layer: register a new builder
 * (proof-of-possession gated) or top up an existing builder's balance.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.11/specs/gloas/beacon-chain.md#new-process_builder_deposit_request
 */
export function processBuilderDepositRequest(
  state: CachedBeaconStateGloas,
  request: gloas.BuilderDepositRequest
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = request;
  const builderIndex = findBuilderIndexByPubkey(state, pubkey);

  if (builderIndex === null) {
    if (!hasBuilderWithdrawalCredentialPrefix(withdrawalCredentials)) {
      return;
    }

    if (isValidBuilderDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      addBuilderToRegistry(
        state,
        pubkey,
        withdrawalCredentials.slice(0, 1),
        withdrawalCredentials.subarray(12),
        amount,
        state.slot
      );
    }
    return;
  }

  const builder = state.builders.get(builderIndex);

  // If the builder has exited and been fully swept (balance drained to 0), reset the
  // withdrawable epoch so this top-up becomes withdrawable again. Must run before the
  // balance increase, since the reset is gated on the current balance being 0.
  if (builder.withdrawableEpoch !== FAR_FUTURE_EPOCH && builder.balance === 0) {
    builder.withdrawableEpoch = computeEpochAtSlot(state.slot) + state.config.MIN_BUILDER_WITHDRAWABILITY_DELAY;
  }

  // Increase balance by deposit amount
  builder.balance += amount;
}
