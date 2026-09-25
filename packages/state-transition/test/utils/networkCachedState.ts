import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {NetworkName} from "@lodestar/config/networks";
import {getNetworkCachedStateBytes} from "@lodestar/test-utils";
import {CachedBeaconStateAllForks} from "../../src/index.js";
import {testCachePath} from "../../src/testUtils/cache.js";
import {createCachedBeaconStateTest} from "../../src/testUtils/state.js";

export async function getNetworkCachedState(network: NetworkName, slot: number): Promise<CachedBeaconStateAllForks> {
  const {config, bytes} = await getNetworkCachedStateBytes(network, slot, testCachePath);
  pubkeyCache.reset();
  return createCachedBeaconStateTest(config.getForkTypes(slot).BeaconState.deserializeToViewDU(bytes), config);
}
