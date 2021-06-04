import {BASE_REWARD_FACTOR, EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {Gwei, ParticipationFlags} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";

export function addFlag(flags: ParticipationFlags, flagIndex: number): ParticipationFlags {
  const flag = 2 ** flagIndex;
  return flags | flag;
}

export function hasFlag(flags: ParticipationFlags, flagIndex: number): boolean {
  const flag = 2 ** flagIndex;
  return (flags & flag) == flag;
}

export function computeBaseRewardPerIncrement(totalActiveStake: Gwei): bigint {
  return (EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR) / bigIntSqrt(totalActiveStake);
}
