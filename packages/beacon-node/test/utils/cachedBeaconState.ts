import {
  BeaconStateAllForks,
  BeaconStateCache,
  createCachedBeaconState,
  createEmptyEpochCacheImmutableData,
} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {getMockedShufflingCache} from "../mocks/shufflingMock.js";

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: ChainForkConfig
): T & BeaconStateCache {
  return createCachedBeaconState<T>(
    state,
    createEmptyEpochCacheImmutableData(chainConfig, getMockedShufflingCache(), state)
  );
}
