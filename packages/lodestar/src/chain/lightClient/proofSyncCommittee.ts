import {allForks, altair, ssz} from "@chainsafe/lodestar-types";
import {Proof, ProofType} from "@chainsafe/persistent-merkle-tree";
import {TreeBacked} from "@chainsafe/ssz";

const genesisProofOffsets = [5, 4, 3, 2, 1];

/**
 * We aren't creating the sync committee proofs separately because our ssz library automatically adds leaves to composite types,
 * so they're already included in the state proof, currently with no way to specify otherwise
 *
 * remove two offsets so the # of offsets in the state proof will be the # expected
 * This is a hack, but properly setting the offsets in the state proof would require either removing witnesses needed for the committees
 * or setting the roots of the committees in the state proof
 * this will always be 1, syncProofLeavesLength
 *
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
export type SyncCommitteeWitness = {
  /** Vector[Bytes32, 4] */
  witness: Uint8Array[];
  currentSyncCommitteeRoot: Uint8Array;
  nextSyncCommitteeRoot: Uint8Array;
};
type SyncCommitteeData = {
  currentSyncCommittee: altair.SyncCommittee;
  nextSyncCommittee: altair.SyncCommittee;
};

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

export function getSyncCommitteesProof(
  syncCommitteeWitness: SyncCommitteeWitness,
  syncCommitteeData: SyncCommitteeData
): Proof {
  return {
    type: ProofType.treeOffset,
    offsets: genesisProofOffsets,
    leaves: [genesisTimeLeave, genesisData.genesisValidatorsRoot, ...genesisWitness],
  };
}

export function getNextSyncCommitteeProof(syncCommitteeWitness: SyncCommitteeWitness): Uint8Array[] {}
