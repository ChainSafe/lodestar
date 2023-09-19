import {MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64} from "@lodestar/types";
import {BeaconStateAllForks} from "../types.js";

export function getEth1DepositCount(state: BeaconStateAllForks): UintNum64 {
  const eth1DataIndexLimit =
    "depositReceiptsStartIndex" in state
      ? Math.min(state.eth1Data.depositCount, state.depositReceiptsStartIndex)
      : Math.min(state.eth1Data.depositCount, 0);

  if (state.eth1DepositIndex < eth1DataIndexLimit) {
    return Math.min(MAX_DEPOSITS, eth1DataIndexLimit - state.eth1DepositIndex);
  }

  return 0;
}
