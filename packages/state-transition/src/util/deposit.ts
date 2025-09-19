import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64, phase0} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";

export function getEth1DepositCount(state: CachedBeaconStateAllForks, eth1Data?: phase0.Eth1Data): UintNum64 {
  const eth1DataToUse = eth1Data ?? state.eth1Data;
  if (state.config.getForkSeq(state.slot) >= ForkSeq.electra) {
    const electraState = state as CachedBeaconStateElectra;
    // eth1DataIndexLimit = min(UintNum64, UintBn64) can be safely casted as UintNum64
    // since the result lies within upper and lower bound of UintNum64
    const eth1DataIndexLimit: UintNum64 =
      eth1DataToUse.depositCount < electraState.depositRequestsStartIndex
        ? eth1DataToUse.depositCount
        : Number(electraState.depositRequestsStartIndex);

    if (state.eth1DepositIndex < eth1DataIndexLimit) {
      return Math.min(MAX_DEPOSITS, eth1DataIndexLimit - state.eth1DepositIndex);
    }
    return 0;
  }
  return Math.min(MAX_DEPOSITS, eth1DataToUse.depositCount - state.eth1DepositIndex);
}
