import {electra} from "@lodestar/types";
import {ForkSeq, UNSET_DEPOSIT_RECEIPTS_START_INDEX} from "@lodestar/params";

import {CachedBeaconStateElectra} from "../types.js";
import {applyDeposit} from "./processDeposit.js";

export function processDepositReceipt(
  fork: ForkSeq,
  state: CachedBeaconStateElectra,
  depositReceipt: electra.DepositReceipt
): void {
  if (state.depositReceiptsStartIndex === UNSET_DEPOSIT_RECEIPTS_START_INDEX) {
    state.depositReceiptsStartIndex = BigInt(depositReceipt.index);
  }

  applyDeposit(fork, state, depositReceipt);
}
