import {altair} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {FINALIZED_ROOT_GINDEX} from "@chainsafe/lodestar-params";
import {SyncCommitteeWitness} from "./types";

export function getSyncCommitteesWitness(state: TreeBacked<altair.BeaconState>): SyncCommitteeWitness {
  const n1 = state.tree.rootNode;
  const n3 = n1.right; // [1]0110
  const n6 = n3.left; // 1[0]110
  const n13 = n6.right; // 10[1]10
  const n27 = n13.right; // 101[1]0
  const currentSyncCommitteeRoot = n27.left.root; // n54 1011[0]
  const nextSyncCommitteeRoot = n27.right.root; // n55 1011[1]

  // Witness branch is sorted by descending gindex
  const witness = [
    n13.left.root, // 26
    n6.left.root, // 12
    n3.right.root, // 7
    n1.left.root, // 2
  ];

  return {
    witness,
    currentSyncCommitteeRoot,
    nextSyncCommitteeRoot,
  };
}

export function getNextSyncCommitteeBranch(syncCommitteesWitness: SyncCommitteeWitness): Uint8Array[] {
  // Witness branch is sorted by descending gindex
  return [syncCommitteesWitness.currentSyncCommitteeRoot, ...syncCommitteesWitness.witness];
}

export function getCurrentSyncCommitteeBranch(syncCommitteesWitness: SyncCommitteeWitness): Uint8Array[] {
  // Witness branch is sorted by descending gindex
  return [syncCommitteesWitness.nextSyncCommitteeRoot, ...syncCommitteesWitness.witness];
}

export function getFinalizedRootProof(state: TreeBacked<altair.BeaconState>): Uint8Array[] {
  return state.tree.getSingleProof(BigInt(FINALIZED_ROOT_GINDEX));
}
