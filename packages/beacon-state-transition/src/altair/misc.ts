import {
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_FLAG_INDEX,
  TIMELY_TARGET_WEIGHT,
} from "@chainsafe/lodestar-params";
import {ParticipationFlags} from "@chainsafe/lodestar-types";

export function getFlagIndicesAndWeights(): [number, bigint][] {
  return [
    [TIMELY_HEAD_FLAG_INDEX, TIMELY_HEAD_WEIGHT],
    [TIMELY_SOURCE_FLAG_INDEX, TIMELY_SOURCE_WEIGHT],
    [TIMELY_TARGET_FLAG_INDEX, TIMELY_TARGET_WEIGHT],
  ];
}
export function addFlag(flags: ParticipationFlags, flagIndex: number): ParticipationFlags {
  const flag = 2 ** flagIndex;
  return flags | flag;
}

export function hasFlag(flags: ParticipationFlags, flagIndex: number): boolean {
  const flag = 2 ** flagIndex;
  return (flags & flag) == flag;
}
