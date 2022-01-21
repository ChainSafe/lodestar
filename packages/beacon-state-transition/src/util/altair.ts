import {BASE_REWARD_FACTOR, EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {bigIntSqrt, bnToNum} from "@chainsafe/lodestar-utils";

/**
 * Before we manage bigIntSqrt(totalActiveStake) as BigInt and return BigInt.
 * bigIntSqrt(totalActiveStake) should fit a number (2 ** 53 -1 max)
 **/
export function computeBaseRewardPerIncrement(totalActiveStakeByIncrement: number): number {
  return Math.floor(
    (EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR) /
      bnToNum(bigIntSqrt(BigInt(totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)))
  );
}
