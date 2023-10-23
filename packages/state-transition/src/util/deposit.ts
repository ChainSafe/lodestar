import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateEIP6110} from "../types.js";

export function getEth1DepositCount(state: CachedBeaconStateAllForks): UintNum64 {
  if (state.config.getForkSeq(state.slot) >= ForkSeq.eip6110) {
    const eip6110State = state as CachedBeaconStateEIP6110;
    // eth1DataIndexLimit = min(UintNum64, UintBn64) can be safely casted as UintNum64 
    // since the result lies within upper and lower bound of UintNum64
    const eth1DataIndexLimit: UintNum64 =
      state.eth1Data.depositCount < eip6110State.depositReceiptsStartIndex
        ? state.eth1Data.depositCount
        : Number(eip6110State.depositReceiptsStartIndex); 

    if (state.eth1DepositIndex < eth1DataIndexLimit) {
      return Math.min(MAX_DEPOSITS, eth1DataIndexLimit - state.eth1DepositIndex); 
    } else {
      return 0;
    }
  } else {
    return Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  }
}
