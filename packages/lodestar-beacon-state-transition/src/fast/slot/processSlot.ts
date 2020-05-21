import {BeaconState} from "@chainsafe/lodestar-types";

import {EpochContext} from "../util";


export function processSlot(epochCtx: EpochContext, state: BeaconState): void {
  const config = epochCtx.config;
  const {SLOTS_PER_HISTORICAL_ROOT} = config.params;
  // cache state root
  const prevStateRoot = config.types.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = prevStateRoot;
  // cache latest block header state root
  if (config.types.Root.equals(state.latestBlockHeader.stateRoot, new Uint8Array(32))) {
    state.latestBlockHeader.stateRoot = prevStateRoot;
  }
  // cache block root
  state.blockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] =
    config.types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
}
