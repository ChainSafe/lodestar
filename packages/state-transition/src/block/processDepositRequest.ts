import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {addBuilderToRegistry, findBuilderIndexByPubkey, isValidBuilderDepositSignature} from "../util/gloas.js";

export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  depositRequest: electra.DepositRequest
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  if (fork === ForkSeq.electra && state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    // depositRequestsStartIndex is only set in Electra. From Fulu the eth1 bridge deposit
    // mechanism was removed.
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
