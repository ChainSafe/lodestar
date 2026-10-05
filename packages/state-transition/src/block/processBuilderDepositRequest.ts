import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {gloas} from "@lodestar/types";
import {isBuilderWithdrawalCredential, isValidBuilderDepositSignature} from "../util/gloas.js";
import {IndexedBuilderState} from "./indexedBuilderState.js";

/**
 * Process a builder deposit request from the execution layer: register a new builder
 * (proof-of-possession gated) or top up an existing builder's balance.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.11/specs/gloas/beacon-chain.md#new-process_builder_deposit_request
 */
export function processBuilderDepositRequest(
  indexedState: IndexedBuilderState,
  request: gloas.BuilderDepositRequest
): void {
  const {state} = indexedState;
  const {pubkey, withdrawalCredentials, amount, signature} = request;

  // Ignore deposits with unexpected withdrawal credential prefixes.
  if (!isBuilderWithdrawalCredential(withdrawalCredentials)) {
    return;
  }

  const builderIndex = indexedState.findBuilderIndexByPubkey(pubkey);

  if (builderIndex === null) {
    if (isValidBuilderDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      indexedState.addBuilderToRegistry(pubkey, PAYLOAD_BUILDER_VERSION, withdrawalCredentials.subarray(12), amount);
    }
    return;
  }

  indexedState.topUp(builderIndex, amount);
}
