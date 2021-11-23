import {allForks} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {FINALIZED_ROOT_INDEX} from "@chainsafe/lodestar-params";
import {SyncCommitteeWitness, GenesisWitness} from "./types";

const genesisProofPaths = [["genesisTime"], ["genesisValidatorsRoot"]];

export type GenesisData = {
  genesisTime: number;
  genesisValidatorsRoot: Uint8Array;
};

export function getGenesisWitness(state: TreeBacked<allForks.BeaconState>): GenesisWitness {
  const proof = state.createProof(genesisProofPaths);
  if (proof.type !== ProofType.treeOffset) {
    throw Error(`Proof type must be treeOffset: ${proof.type}`);
  }

  return proof.leaves.slice(2, 7);
}

export function getSyncCommitteesWitness(state: TreeBacked<allForks.BeaconState>): SyncCommitteeWitness {
  const n1 = state.tree.rootNode;
  const n3 = n1.right; // [1]0110
  const n6 = n3.left; // 1[0]110
  const n13 = n6.right; // 10[1]10
  const n27 = n13.right; // 101[1]0
  const currentSyncCommitteeRoot = n27.left.root; // n54 1011[0]
  const nextSyncCommitteeRoot = n27.right.root; // n55 1011[1]

  const witness = [
    n1.left.root, // 2
    n3.right.root, // 7
    n6.left.root, // 12
    n13.left.root, // 26
  ];

  return {
    witness,
    currentSyncCommitteeRoot,
    nextSyncCommitteeRoot,
  };
}

export function getNextSyncCommitteeBranch(syncCommitteeWitness: SyncCommitteeWitness): Uint8Array[] {
  return [...syncCommitteeWitness.witness, syncCommitteeWitness.currentSyncCommitteeRoot];
}

export function getFinalizedRootProof(state: TreeBacked<allForks.BeaconState>): Uint8Array[] {
  return state.tree.getSingleProof(BigInt(FINALIZED_ROOT_INDEX));
}
