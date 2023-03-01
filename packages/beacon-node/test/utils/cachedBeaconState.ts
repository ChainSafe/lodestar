import {
  BeaconStateAllForks,
  BeaconStateCache,
  createCachedBeaconState,
  createEmptyEpochContextImmutableData,
} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: ChainForkConfig
): T & BeaconStateCache {
  return createCachedBeaconState<T>(state, createEmptyEpochContextImmutableData(chainConfig, state));
}
