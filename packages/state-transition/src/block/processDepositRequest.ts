import {UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";

import {BeaconStateTransitionMetrics} from "../metrics.js";
import {CachedBeaconStateElectra} from "../types.js";

export function processDepositRequest(
  state: CachedBeaconStateElectra,
  depositRequest: electra.DepositRequest,
  metrics?: BeaconStateTransitionMetrics | null
): void {
  if (state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    state.depositRequestsStartIndex = depositRequest.index;
  }

  // Create pending deposit
  const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
    pubkey: depositRequest.pubkey,
    withdrawalCredentials: depositRequest.withdrawalCredentials,
    amount: depositRequest.amount,
    signature: depositRequest.signature,
    slot: state.slot,
  });
  state.pendingDeposits.push(pendingDeposit);
  metrics?.pendingDeposits.set(state.pendingDeposits.length);
}
