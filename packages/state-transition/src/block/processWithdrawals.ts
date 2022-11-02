import {ssz, capella} from "@lodestar/types";
import {MAX_WITHDRAWALS_PER_PAYLOAD} from "@lodestar/params";

import {CachedBeaconStateCapella} from "../types.js";

export function processWithdrawals(
  state: CachedBeaconStateCapella,
  payload: capella.FullOrBlindedExecutionPayload
): void {
  const numWithdrawals = Math.min(MAX_WITHDRAWALS_PER_PAYLOAD, state.withdrawalQueue.length);
  if (numWithdrawals !== payload.withdrawals.length) {
    throw Error(`Invalid withdrawals length expected=${numWithdrawals} actual=${payload.withdrawals.length}`);
  }
  // need to commit else toValue returns nothing, which we need to slice the withdrawal queue
  state.commit();
  const withdrawalQueue = state.withdrawalQueue.toValue();
  const dequedWithdrawals = withdrawalQueue.splice(0, numWithdrawals);
  for (let i = 0; i < numWithdrawals; i++) {
    if (!ssz.capella.Withdrawal.equals(dequedWithdrawals[i], payload.withdrawals[i])) {
      throw Error(`Withdrawal mismatch at index=${i}`);
    }
  }
  //Withdrawal queue has leftover
  state.withdrawalQueue = ssz.capella.WithdrawalQueue.toViewDU(withdrawalQueue);
}
