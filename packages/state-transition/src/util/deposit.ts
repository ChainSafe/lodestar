import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64, phase0} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";

export function getEth1DepositCount(state: CachedBeaconStateAllForks, eth1Data?: phase0.Eth1Data): UintNum64 {
  const eth1DataToUse = eth1Data ?? state.eth1Data;
  // depositCount is a UintBn64 (bigint) so the block root stays byte-exact for proposer-chosen
  // values above 2**53. Narrowing to number here is loss-free in consensus terms: the result is
  // min(MAX_DEPOSITS, depositCount - eth1DepositIndex), so depositCount's exact bits only matter
  // when that gap is < MAX_DEPOSITS, which forces depositCount < eth1DepositIndex + MAX_DEPOSITS
  // (well under 2**53, hence float-exact). Any larger value clamps to MAX_DEPOSITS identically to
  // exact-uint64 arithmetic, so every client computes the same bound.
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
