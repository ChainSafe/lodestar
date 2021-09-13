import {BASE_REWARD_FACTOR, EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {ParticipationFlags} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";

export function addFlag(flags: ParticipationFlags, flagIndex: number): ParticipationFlags {
  const flag = 2 ** flagIndex;
  return flags | flag;
}

export function hasFlag(flags: ParticipationFlags, flagIndex: number): boolean {
  const flag = 2 ** flagIndex;
  return (flags & flag) == flag;
}

/**
 * Before we manage bigIntSqrt(totalActiveStake) as BigInt and return BigInt.
 * bigIntSqrt(totalActiveStake) should fit a number (2 ** 53 -1 max)
 **/
export function computeBaseRewardPerIncrement(totalActiveStakeByIncrement: number): number {
  return Math.floor(
    (EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR) /
      Number(bigIntSqrt(BigInt(totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)))
  );
}

// OLD VERSION
// TODO: remove?
// export function computeBaseRewardPerIncrement(totalActiveStake: Gwei): number {
//   return Math.floor((EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR) / Number(bigIntSqrt(totalActiveStake)));
// }
