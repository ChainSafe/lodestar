import {zeroNode} from "@chainsafe/persistent-merkle-tree";
import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAltair} from "../../types.js";

/**
 * Updates `state.previousEpochParticipation` with precalculated epoch participation. Creates a new empty tree for
 * `state.currentEpochParticipation`.
 *
 * PERF: Cost = 'proportional' $VALIDATOR_COUNT. Since it updates all of them at once, it will always recreate both
 * trees completely.
 */
export function processParticipationFlagUpdates(state: CachedBeaconStateAltair): void {
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
