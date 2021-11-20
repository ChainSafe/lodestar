import {allForks} from "@chainsafe/lodestar-types";
import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {TreeBacked} from "@chainsafe/ssz";
import {GenesisWitness} from "./types";

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
