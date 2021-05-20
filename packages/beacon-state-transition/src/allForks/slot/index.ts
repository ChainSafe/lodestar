import {allForks} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../util";
import {ZERO_HASH} from "../../constants";

/**
 * Dial state to next slot. Common for all forks
 */
export function processSlot(state: CachedBeaconState<allForks.BeaconState>): void {
  const {config} = state;
  const types = config.getTypes(state.slot);

  // Cache state root
  const previousStateRoot = types.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (config.types.Root.equals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = config.types.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  state.blockRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
