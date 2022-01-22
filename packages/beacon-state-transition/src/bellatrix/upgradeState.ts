import {bellatrix, ssz} from "@chainsafe/lodestar-types";
import {createCachedBeaconState} from "../allForks/util";
import {BeaconStateCachedAltair, BeaconStateCachedBellatrix} from "../types";
import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Upgrade a state from altair to bellatrix.
 */
export function upgradeState(state: BeaconStateCachedAltair): BeaconStateCachedBellatrix {
  const {config} = state;
  const postTreeBackedState = upgradeTreeBackedState(config, state);
  // TODO: This seems very sub-optimal, review
  return createCachedBeaconState(config, postTreeBackedState);
}

function upgradeTreeBackedState(
  config: IBeaconConfig,
  state: BeaconStateCachedAltair
): TreeBacked<bellatrix.BeaconState> {
  const stateTB = ssz.phase0.BeaconState.createTreeBacked(state.tree);

  // TODO: Does this preserve the hashing cache? In altair devnets memory spikes on the fork transition
  const postState = ssz.bellatrix.BeaconState.createTreeBacked(stateTB.tree);
  postState.fork = {
    previousVersion: stateTB.fork.currentVersion,
    currentVersion: config.BELLATRIX_FORK_VERSION,
    epoch: state.currentShuffling.epoch,
  };
  // Execution-layer
  postState.latestExecutionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.defaultTreeBacked();

  return postState;
}
