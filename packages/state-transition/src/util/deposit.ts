import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";
import {UintNum64, phase0} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";

export function getEth1DepositCount(state: CachedBeaconStateAllForks, eth1Data?: phase0.Eth1Data): UintNum64 {
  const eth1DataToUse = eth1Data ?? state.eth1Data;
  // depositCount is a UintBn64 (bigint) and is proposer-chosen and unbounded at block validation.
  // Keep the comparison and subtraction in bigint and only narrow the final result — which is
  // clamped to MAX_DEPOSITS — to a number. Converting depositCount to a number before clamping
  // would round a value above 2**53 and could change this consensus-enforced count, so the exact
  // type must be preserved through the arithmetic.
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
