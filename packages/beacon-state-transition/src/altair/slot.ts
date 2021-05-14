import {allForks, altair, ParticipationFlags, phase0, Slot, Uint8} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {processEpoch} from "./epoch";
import {CachedBeaconState, createCachedBeaconState, rotateEpochs} from "../allForks/util";
import {ZERO_HASH} from "../constants";
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

export function upgradeTreeBackedState(
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

export function processSlots(state: CachedBeaconState<altair.BeaconState>, slot: Slot): void {
  assert.lt(state.slot, slot, `Too old slot ${slot}, current=${state.slot}`);
  const {config} = state;

  while (state.slot < slot) {
    processSlot(state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % config.params.SLOTS_PER_EPOCH === 0) {
      processEpoch(state);
      state.slot++;
      rotateEpochs(state.epochCtx, state as CachedBeaconState<allForks.BeaconState>, state.validators);
    } else {
      state.slot++;
    }
  }
}

function processSlot(state: CachedBeaconState<altair.BeaconState>): void {
  const {config} = state;
  // Cache state root
  const previousStateRoot = config.types.altair.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (config.types.Root.equals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = config.types.altair.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  state.blockRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
