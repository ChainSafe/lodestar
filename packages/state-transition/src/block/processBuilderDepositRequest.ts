import {gloas} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {addBuilderToRegistry, findBuilderIndexByPubkey, isValidBuilderDepositSignature} from "../util/gloas.js";

/**
 * Apply a builder deposit request. Either registers a new builder (verifying the proof of
 * possession on first appearance) or tops up an existing builder's balance.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/master/specs/gloas/beacon-chain.md#new-process_builder_deposit_request
 */
export function processBuilderDepositRequest(
  state: CachedBeaconStateGloas,
  request: gloas.BuilderDepositRequest
): void {
  const builderIndex = findBuilderIndexByPubkey(state, request.pubkey);

  if (builderIndex === null) {
    if (isValidBuilderDepositSignature(state.config, request)) {
      addBuilderToRegistry(
        state,
        request.pubkey,
        request.withdrawalCredentials[0],
        request.withdrawalCredentials.subarray(12),
        request.amount,
        state.slot
      );
    }
    return;
  }

  // Top up an existing builder. Withdrawal credentials and signature are ignored — the existing
  // registration is unchanged, matching the validator deposit contract's top-up semantics.
  const builder = state.builders.get(builderIndex);
  builder.balance += request.amount;
}
