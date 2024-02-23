import {
  BeaconStateAllForks,
  BeaconStateCache,
  createCachedBeaconState,
  createEmptyEpochCacheImmutableData,
} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {LogLevel} from "@lodestar/utils";

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: ChainForkConfig
): T & BeaconStateCache {
  return createCachedBeaconState<T>(
    state,
    createEmptyEpochCacheImmutableData(chainConfig, getNodeLogger({level: LogLevel.info}), state)
  );
}
