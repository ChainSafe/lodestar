import {TIMELY_HEAD_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX} from "@lodestar/params";

// We pack both previous and current epoch attester flags
// as well as slashed and eligibility flags into a single number
// to save space in our epoch transition cache.
// Note: the order of the flags is important for efficiently translating
// from the BeaconState flags to our flags.
// [prevSource, prevTarget, prevHead, currSource, currTarget, currHead, unslashed, eligible]
export const FLAG_PREV_SOURCE_ATTESTER = 1 << TIMELY_SOURCE_FLAG_INDEX;
export const FLAG_PREV_TARGET_ATTESTER = 1 << TIMELY_TARGET_FLAG_INDEX;
export const FLAG_PREV_HEAD_ATTESTER = 1 << TIMELY_HEAD_FLAG_INDEX;

export const FLAG_CURR_SOURCE_ATTESTER = 1 << (3 + TIMELY_SOURCE_FLAG_INDEX);
export const FLAG_CURR_TARGET_ATTESTER = 1 << (3 + TIMELY_TARGET_FLAG_INDEX);
export const FLAG_CURR_HEAD_ATTESTER = 1 << (3 + TIMELY_HEAD_FLAG_INDEX);

export const FLAG_UNSLASHED = 1 << 6;
export const FLAG_ELIGIBLE_ATTESTER = 1 << 7;

// Precompute OR flags used in epoch processing
export const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
export const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
export const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;

export function hasMarkers(flags: number, markers: number): boolean {
  return (flags & markers) === markers;
}

export type AttesterFlags = {
  prevSourceAttester: boolean;
  prevTargetAttester: boolean;
  prevHeadAttester: boolean;
  currSourceAttester: boolean;
  currTargetAttester: boolean;
  currHeadAttester: boolean;
  unslashed: boolean;
  eligibleAttester: boolean;
};

export function parseAttesterFlags(flags: number): AttesterFlags {
  return {
    prevSourceAttester: hasMarkers(flags, FLAG_PREV_SOURCE_ATTESTER),
    prevTargetAttester: hasMarkers(flags, FLAG_PREV_TARGET_ATTESTER),
    prevHeadAttester: hasMarkers(flags, FLAG_PREV_HEAD_ATTESTER),
    currSourceAttester: hasMarkers(flags, FLAG_CURR_SOURCE_ATTESTER),
    currTargetAttester: hasMarkers(flags, FLAG_CURR_TARGET_ATTESTER),
    currHeadAttester: hasMarkers(flags, FLAG_CURR_HEAD_ATTESTER),
    unslashed: hasMarkers(flags, FLAG_UNSLASHED),
    eligibleAttester: hasMarkers(flags, FLAG_ELIGIBLE_ATTESTER),
  };
}

export function toAttesterFlags(flagsObj: AttesterFlags): number {
  let flag = 0;
  if (flagsObj.prevSourceAttester) flag |= FLAG_PREV_SOURCE_ATTESTER;
  if (flagsObj.prevTargetAttester) flag |= FLAG_PREV_TARGET_ATTESTER;
  if (flagsObj.prevHeadAttester) flag |= FLAG_PREV_HEAD_ATTESTER;
  if (flagsObj.currSourceAttester) flag |= FLAG_CURR_SOURCE_ATTESTER;
  if (flagsObj.currTargetAttester) flag |= FLAG_CURR_TARGET_ATTESTER;
  if (flagsObj.currHeadAttester) flag |= FLAG_CURR_HEAD_ATTESTER;
  if (flagsObj.unslashed) flag |= FLAG_UNSLASHED;
  if (flagsObj.eligibleAttester) flag |= FLAG_ELIGIBLE_ATTESTER;
  return flag;
}
