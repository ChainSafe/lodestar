import {electra} from "@lodestar/types";
import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";

import {CachedBeaconStateElectra} from "../types.js";
import {applyDeposit} from "./processDeposit.js";

export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra,
  depositRequest: electra.DepositRequest
): void {
  if (state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    state.depositRequestsStartIndex = BigInt(depositRequest.index);
  }

  applyDeposit(fork, state, depositRequest);
}
