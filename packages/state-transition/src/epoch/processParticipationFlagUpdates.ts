import {zeroNode} from "@chainsafe/persistent-merkle-tree";
import {ssz} from "@lodestar/types";
import type {BeaconStateAltair, BeaconStateDecoupled, BeaconStateGloas} from "../types.js";
import {isDecoupledStateType, isGloasStateType} from "../util/execution.js";
import {zeroProgressiveListBasicRootNode} from "../util/ssz.js";

/**
 * Updates `state.previousEpochParticipation` with precalculated epoch participation. Creates a new empty tree for
 * `state.currentEpochParticipation`.
 *
 * PERF: Cost = 'proportional' $VALIDATOR_COUNT. Since it updates all of them at once, it will always recreate both
 * trees completely.
 */
export function processParticipationFlagUpdates(
  state: BeaconStateAltair | BeaconStateGloas | BeaconStateDecoupled
): void {
  if (isDecoupledStateType(state)) {
    processParticipationFlagUpdatesDecoupled(state);
    return;
  }
  if (isGloasStateType(state)) {
    processParticipationFlagUpdatesGloas(state);
    return;
  }

  // Set view and tree from currentEpochParticipation to previousEpochParticipation
  state.previousEpochParticipation = state.currentEpochParticipation;

  // We need to replace the node of currentEpochParticipation with a node that represents and empty list of some length.
  // SSZ represents a list as = new BranchNode(chunksNode, lengthNode).
  // Since the chunks represent all zero'ed data we can re-use the pre-compouted zeroNode at chunkDepth to skip any
  // data transformation and create the required tree almost for free.
  const currentEpochParticipationNode = ssz.altair.EpochParticipation.tree_setChunksNode(
    state.currentEpochParticipation.node,
    zeroNode(ssz.altair.EpochParticipation.chunkDepth),
    state.currentEpochParticipation.length
  );

  state.currentEpochParticipation = ssz.altair.EpochParticipation.getViewDU(currentEpochParticipationNode);
}

function processParticipationFlagUpdatesGloas(state: BeaconStateGloas | BeaconStateDecoupled): void {
  state.previousEpochParticipation = state.currentEpochParticipation;

  // Same trick as the altair path above, adapted to the progressive-list tree shape: all chunks
  // are zero so the chunks tree is a chain of pre-computed zeroNodes, built in O(log n) instead
  // of re-merkleizing a validator-count-sized array every epoch.
  state.currentEpochParticipation = ssz.gloas.EpochParticipation.getViewDU(
    zeroProgressiveListBasicRootNode(ssz.gloas.EpochParticipation.itemsPerChunk, state.currentEpochParticipation.length)
  );
}

// Spec: process_participation_flag_updates [Modified in DC] (decoupled-consensus/beacon-chain.md)
function processParticipationFlagUpdatesDecoupled(state: BeaconStateDecoupled): void {
  processParticipationFlagUpdatesGloas(state);

  state.previousRoundParticipation = state.currentRoundParticipation;
  state.currentRoundParticipation = ssz.gloas.EpochParticipation.getViewDU(
    zeroProgressiveListBasicRootNode(ssz.gloas.EpochParticipation.itemsPerChunk, state.currentRoundParticipation.length)
  );
}
