import {altair, merge, ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconState, createCachedBeaconState} from "../allForks/util";
import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Upgrade a state from altair to merge.
 */
export function upgradeState(state: CachedBeaconState<altair.BeaconState>): CachedBeaconState<merge.BeaconState> {
  const {config} = state;
  const postTreeBackedState = upgradeTreeBackedState(config, state);
  // TODO: This seems very sub-optimal, review
  return createCachedBeaconState(config, postTreeBackedState);
}

function upgradeTreeBackedState(
  config: IBeaconConfig,
  state: CachedBeaconState<altair.BeaconState>
): TreeBacked<merge.BeaconState> {
  const stateTB = ssz.phase0.BeaconState.createTreeBacked(state.tree);

  // TODO: Does this preserve the hashing cache? In altair devnets memory spikes on the fork transition
  const postState = ssz.merge.BeaconState.createTreeBacked(stateTB.tree);
  postState.fork = {
    previousVersion: stateTB.fork.currentVersion,
    currentVersion: config.MERGE_FORK_VERSION,
    epoch: state.currentShuffling.epoch,
  };
  // Execution-layer
  postState.latestExecutionPayloadHeader = ssz.merge.ExecutionPayloadHeader.defaultTreeBacked();

  return postState;
}
