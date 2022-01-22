import {ssz} from "@chainsafe/lodestar-types";
import {SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {BeaconStateCachedAllForks} from "../util";
import {ZERO_HASH} from "../../constants";

/**
 * Dial state to next slot. Common for all forks
 */
export function processSlot(state: BeaconStateCachedAllForks): void {
  const {config} = state;
  const types = config.getForkTypes(state.slot);

  // Cache state root
  const previousStateRoot = types.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (ssz.Root.equals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  state.blockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
