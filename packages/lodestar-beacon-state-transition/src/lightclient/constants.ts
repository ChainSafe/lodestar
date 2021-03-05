import {ValidatorFlag} from "@chainsafe/lodestar-types";

export const TIMELY_HEAD_FLAG: ValidatorFlag = 1;
export const TIMELY_SOURCE_FLAG: ValidatorFlag = 2;
export const TIMELY_TARGET_FLAG: ValidatorFlag = 4;
//probably will be moved to params
export const TIMELY_HEAD_NUMERATOR = 12;
export const TIMELY_SOURCE_NUMERATOR = 12;
export const TIMELY_TARGET_NUMERATOR = 32;
export const FLAG_DENOMINATOR = BigInt(64);
