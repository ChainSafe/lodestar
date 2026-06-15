import {gloas} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {addBuilderToRegistry, findBuilderIndexByPubkey, isValidBuilderDepositSignature} from "../util/gloas.js";

/**
 * Process a builder deposit request from the execution layer. Delegates to the spec's
 * `apply_deposit_for_builder` helper, which registers a new builder (PoP-gated) or tops up
 * an existing builder's balance.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/master/specs/gloas/beacon-chain.md#new-process_builder_deposit_request
 */
export function processBuilderDepositRequest(
  state: CachedBeaconStateGloas,
  request: gloas.BuilderDepositRequest
): void {
  applyDepositForBuilder(
    state,
    request.pubkey,
    request.withdrawalCredentials,
    request.amount,
    request.signature,
    state.slot
  );
}

/**
 * Register a new builder or top up an existing builder's balance from a deposit.
 * Verifies the proof of possession on first appearance; top-ups ignore credentials and signature.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/master/specs/gloas/beacon-chain.md#new-apply_deposit_for_builder
 */
export function applyDepositForBuilder(
  state: CachedBeaconStateGloas,
  pubkey: Uint8Array,
  withdrawalCredentials: Uint8Array,
  amount: number,
  signature: Uint8Array,
  slot: number
): void {
  const builderIndex = findBuilderIndexByPubkey(state, pubkey);

  if (builderIndex === null) {
    if (isValidBuilderDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      addBuilderToRegistry(state, pubkey, withdrawalCredentials[0], withdrawalCredentials.subarray(12), amount, slot);
    }
    return;
  }

  // Top up an existing builder. Withdrawal credentials and signature are ignored — the existing
  // registration is unchanged, matching the validator deposit contract's top-up semantics.
  const builder = state.builders.get(builderIndex);
  builder.balance += amount;
}
