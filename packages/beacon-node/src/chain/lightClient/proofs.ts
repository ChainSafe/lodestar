import {Tree} from "@chainsafe/persistent-merkle-tree";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {
  FINALIZED_ROOT_GINDEX,
  BLOCK_BODY_EXECUTION_PAYLOAD_GINDEX,
  ForkExecution,
  FINALIZED_ROOT_GINDEX_ELECTRA,
} from "@lodestar/params";
import {BeaconBlockBody, SSZTypesFor, ssz} from "@lodestar/types";

import {SyncCommitteeWitness} from "./types.js";

export function getSyncCommitteesWitness(state: BeaconStateAllForks): SyncCommitteeWitness {
  state.commit();
  const n1 = state.node;
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

export function getFinalizedRootProof(state: CachedBeaconStateAllForks): Uint8Array[] {
  state.commit();
  const finalizedRootGindex = state.epochCtx.isPostElectra() ? FINALIZED_ROOT_GINDEX_ELECTRA : FINALIZED_ROOT_GINDEX;
  return new Tree(state.node).getSingleProof(BigInt(finalizedRootGindex));
}

export function getBlockBodyExecutionHeaderProof(
  fork: ForkExecution,
  body: BeaconBlockBody<ForkExecution>
): Uint8Array[] {
  const bodyView = (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkExecution, "BeaconBlockBody">).toView(body);
  return new Tree(bodyView.node).getSingleProof(BigInt(BLOCK_BODY_EXECUTION_PAYLOAD_GINDEX));
}
