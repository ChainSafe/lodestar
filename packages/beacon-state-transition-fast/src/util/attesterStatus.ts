import {IFlatValidator} from "./flatValidator";

export const FLAG_PREV_SOURCE_ATTESTER = 1 << 0;
export const FLAG_PREV_TARGET_ATTESTER = 1 << 1;
export const FLAG_PREV_HEAD_ATTESTER = 1 << 2;
export const FLAG_CURR_SOURCE_ATTESTER = 1 << 3;
export const FLAG_CURR_TARGET_ATTESTER = 1 << 4;
export const FLAG_CURR_HEAD_ATTESTER = 1 << 5;
export const FLAG_UNSLASHED = 1 << 6;
export const FLAG_ELIGIBLE_ATTESTER = 1 << 7;

export interface IAttesterStatus {
  flags: number;
  proposerIndex: number; // -1 when not included by any proposer
  inclusionDelay: number;
  validator: IFlatValidator;
  active: boolean;
}

export function createIAttesterStatus(v: IFlatValidator): IAttesterStatus {
  return {
    flags: 0,
    proposerIndex: -1,
    inclusionDelay: 0,
    validator: v,
    active: false,
  };
}

export function hasMarkers(flags: number, markers: number): boolean {
  return (flags & markers) === markers;
}
