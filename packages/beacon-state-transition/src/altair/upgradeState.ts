import {altair, ParticipationFlags, phase0, Uint8} from "@chainsafe/lodestar-types";
import {CachedBeaconState, createCachedBeaconState} from "../allForks/util";
import {getCurrentEpoch, newZeroedArray} from "../util";
import {List, TreeBacked} from "@chainsafe/ssz";
import {getSyncCommittee} from "./state_accessor";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Upgrade a state from phase0 to altair.
 * @param state
 */
export function upgradeState(state: CachedBeaconState<phase0.BeaconState>): CachedBeaconState<altair.BeaconState> {
  const {config} = state;
  const postState = upgradeTreeBackedState(config, config.types.phase0.BeaconState.createTreeBacked(state.tree));
  return createCachedBeaconState(config, postState);
}

function upgradeTreeBackedState(
  config: IBeaconConfig,
  state: TreeBacked<phase0.BeaconState>
): TreeBacked<altair.BeaconState> {
  const validatorCount = state.validators.length;
  const epoch = getCurrentEpoch(config, state);
  const postState = config.types.altair.BeaconState.createTreeBacked(state.tree);
  postState.fork = {
    previousVersion: state.fork.currentVersion,
    currentVersion: config.params.ALTAIR_FORK_VERSION,
    epoch,
  };
  // TODO: translate_participation in https://github.com/ethereum/eth2.0-specs/blob/dev/specs/altair/fork.md
  postState.previousEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.currentEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.inactivityScores = newZeroedArray(validatorCount) as List<Uint8>;
  const syncCommittee = getSyncCommittee(config, state, epoch);
  postState.currentSyncCommittee = syncCommittee;
  postState.nextSyncCommittee = syncCommittee;
  return postState;
}
