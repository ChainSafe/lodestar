import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStateElectra, CachedBeaconStateGloas, CachedBeaconStatePq} from "../types.js";
import {computeDepositPubkey} from "../util/pq.js";
import {getActivePreregistration, removeStoredPreregistration} from "./processPreregistrationRequest.js";

export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  depositRequest: electra.DepositRequest
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  // From pq a deposit carries no signature. While a preregistration binds its key, only a deposit
  // that matches the binding is accepted, and it consumes the binding.
  if (fork === ForkSeq.pq) {
    const statePq = state as unknown as CachedBeaconStatePq;
    const xmssPubkey = computeDepositPubkey(pubkey);
    const preregistration = getActivePreregistration(statePq, xmssPubkey);
    if (preregistration !== null) {
      if (!byteArrayEquals(withdrawalCredentials, preregistration.withdrawalCredentials)) return;
      if (!byteArrayEquals(signature.subarray(0, 32), preregistration.vrfRoot)) return;
      removeStoredPreregistration(statePq, xmssPubkey);
    }
  }

  if (fork === ForkSeq.electra && state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
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
