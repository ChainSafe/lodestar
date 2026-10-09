import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {CachedBeaconStateElectra, CachedBeaconStateGloas, CachedBeaconStateHeze} from "../types.js";

export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas | CachedBeaconStateHeze,
  depositRequest: electra.DepositRequest
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  if (fork === ForkSeq.electra) {
    const stateElectra = state as CachedBeaconStateElectra;
    if (stateElectra.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
      stateElectra.depositRequestsStartIndex = depositRequest.index;
    }
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
