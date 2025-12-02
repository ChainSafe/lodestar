import {ChainForkConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  BeaconStateCache,
  createCachedBeaconState,
  createEmptyEpochCacheImmutableData,
} from "@lodestar/state-transition";

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: ChainForkConfig
): T & BeaconStateCache {
  return createCachedBeaconState<T>(state, createEmptyEpochCacheImmutableData(chainConfig, state));
}
