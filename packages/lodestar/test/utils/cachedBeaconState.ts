import {
  BeaconStateAllForks,
  BeaconStateCache,
  createCachedBeaconState,
  createEmptyEpochContextImmutableData,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: IChainForkConfig
): T & BeaconStateCache {
  return createCachedBeaconState<T>(state, createEmptyEpochContextImmutableData(chainConfig, state));
}
