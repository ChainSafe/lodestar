import {CachedBeaconState} from "../util/cachedBeaconState";

export function processSlot(cachedState: CachedBeaconState): void {
  const config = cachedState.config;
  const {SLOTS_PER_HISTORICAL_ROOT} = config.params;
  // cache state root
  const prevStateRoot = cachedState.hashTreeRoot();
  cachedState.stateRoots[cachedState.slot % SLOTS_PER_HISTORICAL_ROOT] = prevStateRoot;
  // cache latest block header state root
  if (config.types.Root.equals(cachedState.latestBlockHeader.stateRoot, new Uint8Array(32))) {
    cachedState.latestBlockHeader.stateRoot = prevStateRoot;
  }
  // cache block root
  cachedState.blockRoots[cachedState.slot % SLOTS_PER_HISTORICAL_ROOT] = config.types.BeaconBlockHeader.hashTreeRoot(
    cachedState.latestBlockHeader
  );
}
