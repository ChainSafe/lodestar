import {
  BeaconStateAllForks,
  BeaconStateCache,
  createCachedBeaconState,
  createEmptyEpochContextImmutableData,
} from "@lodestar/state-transition";
import {IChainForkConfig} from "@lodestar/config";

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: IChainForkConfig
): T & BeaconStateCache {
  return createCachedBeaconState<T>(state, createEmptyEpochContextImmutableData(chainConfig, state));
}
