import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../util";

export function processSlot(state: CachedBeaconState<phase0.BeaconState>): void {
  const config = state.config;
  const {SLOTS_PER_HISTORICAL_ROOT} = config.params;
  // cache state root
  const prevStateRoot = state.tree.root;
  state.stateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = prevStateRoot;
  // cache latest block header state root
  if (config.types.Root.equals(state.latestBlockHeader.stateRoot, new Uint8Array(32))) {
    state.latestBlockHeader.stateRoot = prevStateRoot;
  }
  // cache block root
  state.blockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = config.types.phase0.BeaconBlockHeader.hashTreeRoot(
    state.latestBlockHeader
  );
}
