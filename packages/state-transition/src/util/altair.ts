import {BASE_REWARD_FACTOR, BASE_REWARD_FACTOR_EIP7782, EFFECTIVE_BALANCE_INCREMENT, ForkSeq} from "@lodestar/params";
import {bigIntSqrt, bnToNum} from "@lodestar/utils";

/**
 * Before we manage bigIntSqrt(totalActiveStake) as BigInt and return BigInt.
 * bigIntSqrt(totalActiveStake) should fit a number (2 ** 53 -1 max)
 **/
export function computeBaseRewardPerIncrement(totalActiveStakeByIncrement: number, fork?: ForkSeq): number {
  // EIP-7782: Use halved base reward factor post-fork
  const rewardFactor = fork !== undefined && fork >= ForkSeq.eip7782 ? BASE_REWARD_FACTOR_EIP7782 : BASE_REWARD_FACTOR;
  return Math.floor(
    (EFFECTIVE_BALANCE_INCREMENT * rewardFactor) /
      bnToNum(bigIntSqrt(BigInt(totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)))
  );
}
