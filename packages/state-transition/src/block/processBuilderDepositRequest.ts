import {gloas} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {applyDepositForBuilder} from "./processDepositRequest.js";

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
