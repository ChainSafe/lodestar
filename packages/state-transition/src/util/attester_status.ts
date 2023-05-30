export const FLAG_PREV_SOURCE_ATTESTER = 1 << 0;
export const FLAG_PREV_TARGET_ATTESTER = 1 << 1;
export const FLAG_PREV_HEAD_ATTESTER = 1 << 2;
export const FLAG_CURR_SOURCE_ATTESTER = 1 << 3;
export const FLAG_CURR_TARGET_ATTESTER = 1 << 4;
export const FLAG_CURR_HEAD_ATTESTER = 1 << 5;

export const FLAG_UNSLASHED = 1 << 6;
export const FLAG_ELIGIBLE_ATTESTER = 1 << 7;
// Precompute OR flags
export const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
export const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
export const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;

/**
 * During the epoch transition, additional data is precomputed to avoid traversing any state a second
 * time. Attestations are a big part of this, and each validator has a "status" to represent its
 * precomputed participation.
 */
export type AttesterStatus = {
  flags: number;
  proposerIndex: number; // -1 when not included by any proposer
  inclusionDelay: number;
  active: boolean;
};

export function createAttesterStatus(): AttesterStatus {
  return {
    flags: 0,
    proposerIndex: -1,
    inclusionDelay: 0,
    active: false,
  };
}

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
