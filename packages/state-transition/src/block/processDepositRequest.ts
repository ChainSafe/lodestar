import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {isBuilderWithdrawalCredential} from "../util/gloas.js";

export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  depositRequest: electra.DepositRequest
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  if (fork >= ForkSeq.gloas) {
    // [New in Gloas:EIP8282] Builder-credentialed deposits on the validator deposit contract are
    // inert post-fork: not appended to pending_deposits, ETH forfeited in the immutable deposit
    // contract. Builders are created and topped up only via BuilderDepositRequest.
    if (isBuilderWithdrawalCredential(withdrawalCredentials)) {
      return;
    }
  } else if (fork === ForkSeq.electra && state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
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
