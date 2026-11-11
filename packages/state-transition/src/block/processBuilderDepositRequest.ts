import {FAR_FUTURE_EPOCH, ForkSeq, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {gloas} from "@lodestar/types";
import {computeEpochAtSlot} from "../util/epoch.js";
import {initiateBuilderExit, isBuilderWithdrawalCredential, isValidBuilderDepositSignature} from "../util/gloas.js";
import {computeDepositPubkey, isLegacyPubkey} from "../util/pq.js";
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

  // From pq a builder deposit carries no signature, and a legacy one, which names a BLS public
  // key, is for the leanXMSS key derived from it
  const isPq = state.config.getForkSeq(state.slot) === ForkSeq.pq;
  const builderPubkey = isPq ? computeDepositPubkey(pubkey) : pubkey;
  const builderIndex = indexedState.findBuilderIndexByPubkey(builderPubkey);

  if (builderIndex === null) {
    if (isPq || isValidBuilderDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      indexedState.addBuilderToRegistry(
        builderPubkey,
        PAYLOAD_BUILDER_VERSION,
        withdrawalCredentials.subarray(12),
        amount
      );
    }
    if (isPq && isLegacyPubkey(pubkey)) {
      // No signature verifies against a legacy deposit's key: its builder exits at once
      initiateBuilderExit(state, indexedState.findBuilderIndexByPubkey(builderPubkey) as number);
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
