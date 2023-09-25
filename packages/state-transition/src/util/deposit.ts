import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateEIP6110} from "../types.js";

export function getEth1DepositCount(state: CachedBeaconStateAllForks): UintNum64 {

  if (state.config.getForkSeq(state.slot) >= ForkSeq.eip6110) {
    const eip6110State = state as CachedBeaconStateEIP6110;
    const eth1DataIndexLimit = state.eth1Data.depositCount < eip6110State.depositReceiptsStartIndex ? state.eth1Data.depositCount : eip6110State.depositReceiptsStartIndex;

    if (state.eth1DepositIndex < eth1DataIndexLimit) {
      return Math.min(MAX_DEPOSITS, Number(eth1DataIndexLimit) - state.eth1DepositIndex); // eth1DataIndexLimit can be safely casted as number
    } else {
      return 0;
    }
  } else {
    return Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  }

}
