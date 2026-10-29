import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {NetworkName} from "@lodestar/config/networks";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {testCachePath} from "@lodestar/state-transition/test-utils";
import {getNetworkCachedBlockBytes, getNetworkCachedStateBytes} from "@lodestar/test-utils";
import {SignedBeaconBlock} from "@lodestar/types";
import {createCachedBeaconStateTest} from "./cachedBeaconState.js";

export async function getNetworkCachedState(network: NetworkName, slot: number): Promise<CachedBeaconStateAllForks> {
  const {config, bytes} = await getNetworkCachedStateBytes(network, slot, testCachePath);
  pubkeyCache.reset();
  return createCachedBeaconStateTest(config.getForkTypes(slot).BeaconState.deserializeToViewDU(bytes), config);
}

export async function getNetworkCachedBlock(network: NetworkName, slot: number): Promise<SignedBeaconBlock> {
  const {config, bytes} = await getNetworkCachedBlockBytes(network, slot, testCachePath);
  return config.getForkTypes(slot).SignedBeaconBlock.deserialize(bytes);
}
