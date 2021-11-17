import {allForks} from "@chainsafe/lodestar-types";
import {Proof, ProofType} from "@chainsafe/persistent-merkle-tree";
import {TreeBacked} from "@chainsafe/ssz";

const genesisProofOffsets = [5, 4, 3, 2, 1];
const finalizedCheckpointPaths = [["finalizedCheckpoint"]];

/**
 * `GenesisWitness = Vector[Bytes32, 4]`
 *
 * With empty state (minimal)
 * - `genesisTime = 0xffffffff`
 * - `genesisValidatorsRoot = Buffer.alloc(32, 1)`
 *
 * Proof:
 * ```
 * offsets: [ 5, 4, 3, 2, 1 ]
 * leaves: [
 *   '0xffffffff00000000000000000000000000000000000000000000000000000000',
 *   '0x0101010101010101010101010101010101010101010101010101010101010101',
 *   '0xb11b8bcf59425d6c99019cca1d2c2e47b51a2f74917a67ad132274f43e13ec43',
 *   '0x74bd1f2437cdf74b0904ee525d8da070a3fa27570942bf42cbab3dc5939600f0',
 *   '0x7f06739e5a42360c56e519a511675901c95402ea9877edc0d9a87471b1374a6a',
 *   '0x9f534204ba3c0b69fcb42a11987bfcbc5aea0463e5b0614312ded4b62cf3a380'
 * ]
 * ```
 */
export type FinalizedCheckpointWitness = Uint8Array[];
type GenesisData = {
  genesisTime: number;
  genesisValidatorsRoot: Uint8Array;
};

export function getFinalizedCheckpointWitness(state: TreeBacked<allForks.BeaconState>): FinalizedCheckpointWitness {
  const proof = state.createProof(finalizedCheckpointPaths);
  if (proof.type !== ProofType.treeOffset) {
    throw Error(`Proof type must be treeOffset: ${proof.type}`);
  }

  return proof.leaves;
}

export function getGenesisProof(genesisWitness: FinalizedCheckpointWitness, genesisData: GenesisData): Proof {
  const genesisTimeLeave = Buffer.alloc(32, 0);
  genesisTimeLeave.writeInt32LE(genesisData.genesisTime, 0);

  return {
    type: ProofType.treeOffset,
    offsets: genesisProofOffsets,
    leaves: [genesisTimeLeave, genesisData.genesisValidatorsRoot, ...genesisWitness],
  };
}
