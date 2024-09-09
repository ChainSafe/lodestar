import {ZERO_HASH} from "../spec/utils.js";

export const SYNC_COMMITTEES_DEPTH = 4;
export const SYNC_COMMITTEES_INDEX = 11;

/**
 * Given merkle branch ``branch``, extend its depth according to ``depth``
 * If given ``depth`` is less than the depth of ``branch``, it will return
 * unmodified ``branch``
 */
export function normalizeMerkleBranch(branch: Uint8Array[], depth: number): Uint8Array[] {
  const numExtraDepth = depth - branch.length;

  return [...Array.from({length: numExtraDepth}, () => ZERO_HASH), ...branch];
}
