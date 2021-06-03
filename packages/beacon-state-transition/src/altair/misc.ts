import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Gwei, ParticipationFlags} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {TIMELY_HEAD_WEIGHT, TIMELY_SOURCE_WEIGHT, TIMELY_TARGET_WEIGHT} from "./constants";

export const PARTICIPATION_FLAG_WEIGHTS = [TIMELY_SOURCE_WEIGHT, TIMELY_TARGET_WEIGHT, TIMELY_HEAD_WEIGHT];
export function addFlag(flags: ParticipationFlags, flagIndex: number): ParticipationFlags {
  const flag = 2 ** flagIndex;
  return flags | flag;
}

export function hasFlag(flags: ParticipationFlags, flagIndex: number): boolean {
  const flag = 2 ** flagIndex;
  return (flags & flag) == flag;
}

export function computeBaseRewardPerIncrement(config: IBeaconConfig, totalActiveStake: Gwei): bigint {
  return (
    (config.params.EFFECTIVE_BALANCE_INCREMENT * BigInt(config.params.BASE_REWARD_FACTOR)) /
    bigIntSqrt(totalActiveStake)
  );
}
