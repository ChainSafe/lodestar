import {ValidatorFlag} from "@chainsafe/lodestar-types";
import {
  TIMELY_HEAD_FLAG,
  TIMELY_HEAD_NUMERATOR,
  TIMELY_SOURCE_NUMERATOR,
  TIMELY_TARGET_NUMERATOR,
  TIMELY_SOURCE_FLAG,
  TIMELY_TARGET_FLAG,
} from "./constants";

export function addValidatorFlags(flags: ValidatorFlag, add: ValidatorFlag): ValidatorFlag {
  return flags | add;
}

export function hasValidatorFlags(flags: ValidatorFlag, has: ValidatorFlag): boolean {
  return (flags & has) == has;
}

export function getFlagsAndNumerators(): [ValidatorFlag, number][] {
  return [
    [TIMELY_HEAD_FLAG, TIMELY_HEAD_NUMERATOR],
    [TIMELY_SOURCE_FLAG, TIMELY_SOURCE_NUMERATOR],
    [TIMELY_TARGET_FLAG, TIMELY_TARGET_NUMERATOR],
  ];
}
