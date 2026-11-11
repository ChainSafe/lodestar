import {Tree} from "@chainsafe/persistent-merkle-tree";
import {
  BLOCK_BODY_EXECUTION_PAYLOAD_GINDEX,
  CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS,
  FINALIZED_ROOT_GINDEX,
  FINALIZED_ROOT_GINDEX_ELECTRA,
  FINALIZED_ROOT_GINDEX_GLOAS,
  ForkName,
  ForkPostBellatrix,
  ForkPreGloas,
  NEXT_SYNC_COMMITTEE_GINDEX_GLOAS,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {BlindedBeaconBlockBody, SSZTypesFor, ssz} from "@lodestar/types";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "../types.js";
import {SyncCommitteeWitness} from "./types.js";

export function getSyncCommitteesWitness(fork: ForkName, state: BeaconStateAllForks): SyncCommitteeWitness {
  const n1 = state.node;
  let witness: Uint8Array[];
  let currentSyncCommitteeRoot: Uint8Array;
  let nextSyncCommitteeRoot: Uint8Array;

  if (isForkPostGloas(fork)) {
    const tree = new Tree(state.node);
    const currentSyncCommitteeGindex = BigInt(CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS);
    const nextSyncCommitteeGindex = BigInt(NEXT_SYNC_COMMITTEE_GINDEX_GLOAS);

    currentSyncCommitteeRoot = tree.getRoot(currentSyncCommitteeGindex);
    nextSyncCommitteeRoot = tree.getRoot(nextSyncCommitteeGindex);
    witness = [];

    return {
      witness,
      currentSyncCommitteeRoot,
      nextSyncCommitteeRoot,
      currentSyncCommitteeBranch: tree.getSingleProof(currentSyncCommitteeGindex),
      nextSyncCommitteeBranch: tree.getSingleProof(nextSyncCommitteeGindex),
    };
  }

  if (isForkPostElectra(fork)) {
    const n2 = n1.left;
    const n5 = n2.right;
    const n10 = n5.left;
    const n21 = n10.right;
    const n43 = n21.right;

    currentSyncCommitteeRoot = n43.left.root; // n86
    nextSyncCommitteeRoot = n43.right.root; // n87

    // Witness branch is sorted by descending gindex
    witness = [
      n21.left.root, // 42
      n10.left.root, // 20
      n5.right.root, // 11
      n2.left.root, // 4
      n1.right.root, // 3
    ];
  } else {
    const n3 = n1.right; // [1]0110
    const n6 = n3.left; // 1[0]110
    const n13 = n6.right; // 10[1]10
    const n27 = n13.right; // 101[1]0
    currentSyncCommitteeRoot = n27.left.root; // n54 1011[0]
    nextSyncCommitteeRoot = n27.right.root; // n55 1011[1]

    // Witness branch is sorted by descending gindex
    witness = [
      n13.left.root, // 26
      n6.left.root, // 12
      n3.right.root, // 7
      n1.left.root, // 2
    ];
  }

  return {
    witness,
    currentSyncCommitteeRoot,
    nextSyncCommitteeRoot,
  };
}

export function getNextSyncCommitteeBranch(syncCommitteesWitness: SyncCommitteeWitness): Uint8Array[] {
  if (syncCommitteesWitness.nextSyncCommitteeBranch) {
    return syncCommitteesWitness.nextSyncCommitteeBranch;
  }

  // Witness branch is sorted by descending gindex
  return [syncCommitteesWitness.currentSyncCommitteeRoot, ...syncCommitteesWitness.witness];
}

export function getCurrentSyncCommitteeBranch(syncCommitteesWitness: SyncCommitteeWitness): Uint8Array[] {
  if (syncCommitteesWitness.currentSyncCommitteeBranch) {
    return syncCommitteesWitness.currentSyncCommitteeBranch;
  }

  // Witness branch is sorted by descending gindex
  return [syncCommitteesWitness.nextSyncCommitteeRoot, ...syncCommitteesWitness.witness];
}

export function getFinalizedRootProof(state: CachedBeaconStateAllForks): Uint8Array[] {
  const fork = state.config.getForkName(state.slot);
  const finalizedRootGindex = isForkPostGloas(fork)
    ? FINALIZED_ROOT_GINDEX_GLOAS
    : state.epochCtx.isPostElectra()
      ? FINALIZED_ROOT_GINDEX_ELECTRA
      : FINALIZED_ROOT_GINDEX;
  return new Tree(state.node).getSingleProof(BigInt(finalizedRootGindex));
}

/**
 * Proof of the execution payload in a block body. The body is given with the payload header in place of the
 * payload: it has the same root and the same branch, and building its tree does not merkleize the transactions.
 */
export function getBlockBodyExecutionHeaderProof(
  fork: ForkPostBellatrix & ForkPreGloas,
  blindedBody: BlindedBeaconBlockBody<ForkPostBellatrix & ForkPreGloas>
): Uint8Array[] {
  const bodyView = (
    ssz[fork].BlindedBeaconBlockBody as SSZTypesFor<ForkPostBellatrix & ForkPreGloas, "BlindedBeaconBlockBody">
  ).toView(blindedBody);
  return new Tree(bodyView.node).getSingleProof(BigInt(BLOCK_BODY_EXECUTION_PAYLOAD_GINDEX));
}
