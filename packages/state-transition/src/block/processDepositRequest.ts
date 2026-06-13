import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";

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
  // Note: `process_deposit_request` is intentionally unchanged in Gloas — builder onboarding moved to
  // `process_builder_deposit_request`. A regular DepositRequest carrying `BUILDER_WITHDRAWAL_PREFIX = 0x03`
  // still creates a regular validator (see consensus-specs #5359); the prefix is only meaningful for
  // pre-fork pending deposits handled by `onboard_builders_from_pending_deposits` at the fork.

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
