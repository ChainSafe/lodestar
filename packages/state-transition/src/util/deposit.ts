import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64, phase0} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";

export function getEth1DepositCount(state: CachedBeaconStateAllForks, eth1Data?: phase0.Eth1Data): UintNum64 {
  const eth1DataToUse = eth1Data ?? state.eth1Data;
  // Proposer can set any value, use in bigint until the result is bounded by MAX_DEPOSITS
  const depositCount = eth1DataToUse.depositCount;
  const eth1DepositIndex = BigInt(state.eth1DepositIndex);
  const maxDeposits = BigInt(MAX_DEPOSITS);
  if (state.config.getForkSeq(state.slot) >= ForkSeq.electra) {
    const electraState = state as CachedBeaconStateElectra;
    const eth1DataIndexLimit =
      depositCount < electraState.depositRequestsStartIndex ? depositCount : electraState.depositRequestsStartIndex;

    if (eth1DepositIndex < eth1DataIndexLimit) {
      const available = eth1DataIndexLimit - eth1DepositIndex;
      return Number(available < maxDeposits ? available : maxDeposits);
    }
    return 0;
  }
  const available = depositCount - eth1DepositIndex;
  return Number(available < maxDeposits ? available : maxDeposits);
}
