import {gloas} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStateGloas} from "../types.js";
import {
  findBuilderIndexByPubkey,
  getPendingBalanceToWithdrawForBuilder,
  initiateBuilderExit,
  isActiveBuilder,
} from "../util/gloas.js";

/**
 * Apply a builder exit request. Authorizes the exit via `source_address` (the builder's
 * execution_address), not the BLS key — mirroring EIP-7002's 0x01 credential exit.
 *
 * Drops the request silently if any precondition fails; the EL has already dequeued it
 * deterministically, so the fee is forfeited but `requests_hash` agreement is unaffected.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.11/specs/gloas/beacon-chain.md#new-process_builder_exit_request
 */
export function processBuilderExitRequest(state: CachedBeaconStateGloas, request: gloas.BuilderExitRequest): void {
  const builderIndex = findBuilderIndexByPubkey(state, request.pubkey);
  if (builderIndex === null) {
    return;
  }

  const builder = state.builders.getReadonly(builderIndex);

  if (!isActiveBuilder(builder, state.finalizedCheckpoint.epoch)) {
    return;
  }
  if (!byteArrayEquals(builder.executionAddress, request.sourceAddress)) {
    return;
  }
  if (getPendingBalanceToWithdrawForBuilder(state, builderIndex) !== 0) {
    return;
  }

  initiateBuilderExit(state, builderIndex);
}
