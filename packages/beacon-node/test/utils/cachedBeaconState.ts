import {
  BeaconStateAllForks,
  BeaconStateCache,
  createFinalizedCachedBeaconState,
  createEmptyEpochCacheImmutableData,
} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";

export function createFinalizedCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: ChainForkConfig
): T & BeaconStateCache {
  return createFinalizedCachedBeaconState<T>(state, createEmptyEpochCacheImmutableData(chainConfig, state));
}
