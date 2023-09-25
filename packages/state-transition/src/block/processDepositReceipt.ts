import {eip6110} from "@lodestar/types";
import {ForkSeq, UNSET_DEPOSIT_RECEIPTS_START_INDEX} from "@lodestar/params";

import {CachedBeaconStateEIP6110} from "../types.js";
import {applyDeposit} from "./processDeposit.js";

export function processDepositReceipt(
  fork: ForkSeq,
  state: CachedBeaconStateEIP6110,
  depositReceipt: eip6110.DepositReceipt
): void {
  if (state.depositReceiptsStartIndex === UNSET_DEPOSIT_RECEIPTS_START_INDEX) {
    state.depositReceiptsStartIndex = BigInt(depositReceipt.index);
  }

  applyDeposit(
    fork,
    state,
    depositReceipt
  );
}
