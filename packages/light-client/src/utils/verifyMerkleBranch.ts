import {byteArrayEquals} from "@chainsafe/ssz";
import {hash} from "@chainsafe/persistent-merkle-tree";

export const SYNC_COMMITTEES_DEPTH = 4;
export const SYNC_COMMITTEES_INDEX = 11;

/**
 * Verify that the given ``leaf`` is on the merkle branch ``proof``
 * starting with the given ``root``.
 *
 * Browser friendly version of verifyMerkleBranch
 */
export function isValidMerkleBranch(
  leaf: Uint8Array,
  proof: Uint8Array[],
  depth: number,
  index: number,
  root: Uint8Array
): boolean {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    if (Math.floor(index / 2 ** i) % 2) {
      value = hash(proof[i], value);
    } else {
      value = hash(value, proof[i]);
    }
  }
  return byteArrayEquals(value, root);
}

/**
 * An altair beacon state has 24 fields, with a depth of 5.
 *
 * | field                 | gindex | index |
 * | --------------------- | ------ | ----- |
 * | currentSyncCommittee  | 54     | 22    |
 * | nextSyncCommittee     | 55     | 23    |
 *
 * The common parent of gindex 54 and 55 is `2**4 + 22/2 = 27`
 */
export function isValidSyncCommitteesBranch(
  currentSyncCommitteeRoot: Uint8Array,
  nextSyncCommitteeRoot: Uint8Array,
  syncCommitteesBranch: Uint8Array[],
  stateRoot: Uint8Array
): boolean {
  const syncCommitteesRoot = hash(currentSyncCommitteeRoot, nextSyncCommitteeRoot);

  return isValidMerkleBranch(
    // Leaf, gindex 27
    syncCommitteesRoot,
    // Vector[4, Bytes32]
    syncCommitteesBranch,
    SYNC_COMMITTEES_DEPTH,
    SYNC_COMMITTEES_INDEX,
    stateRoot
  );
}
