import {electra, ssz} from "@lodestar/types";
import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";

import {CachedBeaconStateElectra} from "../types.js";

export function processDepositRequest(state: CachedBeaconStateElectra, depositRequest: electra.DepositRequest): void {
  if (state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    state.depositRequestsStartIndex = BigInt(depositRequest.index);
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
}
