import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64, phase0} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";

export function getEth1DepositCount(state: CachedBeaconStateAllForks, eth1Data?: phase0.Eth1Data): UintNum64 {
  const eth1DataToUse = eth1Data ?? state.eth1Data;
  // depositCount is a UintBn64 (bigint) so the consensus block root stays byte-exact for
  // proposer-chosen values above 2**53. The number of deposits actually processed is always within
  // safe-integer range (bounded by MAX_DEPOSITS and the real deposit index), so narrow to a number
  // for the arithmetic below.
  const depositCount = Number(eth1DataToUse.depositCount);
  if (state.config.getForkSeq(state.slot) >= ForkSeq.electra) {
    const electraState = state as CachedBeaconStateElectra;
    // eth1DataIndexLimit = min(UintNum64, UintBn64) can be safely casted as UintNum64
    // since the result lies within upper and lower bound of UintNum64
    const eth1DataIndexLimit: UintNum64 =
      depositCount < Number(electraState.depositRequestsStartIndex)
        ? depositCount
        : Number(electraState.depositRequestsStartIndex);

    if (state.eth1DepositIndex < eth1DataIndexLimit) {
      return Math.min(MAX_DEPOSITS, eth1DataIndexLimit - state.eth1DepositIndex);
    }
    return 0;
  }
  return Math.min(MAX_DEPOSITS, depositCount - state.eth1DepositIndex);
}
