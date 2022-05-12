import fs from "node:fs";
import path from "node:path";
import {getClient} from "@chainsafe/lodestar-api";
import {NetworkName, networksChainConfig} from "@chainsafe/lodestar-config/networks";
import {createIChainForkConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconStateAllForks, computeEpochAtSlot} from "../../src";
import {getInfuraBeaconUrl} from "./infura";
import {testCachePath} from "../cache";
import {createCachedBeaconStateTest} from "../utils/state";
import {allForks} from "@chainsafe/lodestar-types";

/**
 * Create a network config from known network params
 */
export function getNetworkConfig(network: NetworkName): IChainForkConfig {
  const configNetwork = networksChainConfig[network];
  return createIChainForkConfig(configNetwork);
}

/**
 * Download a state from Infura. Caches states in local fs by network and slot to only download once.
 */
export async function getNetworkCachedState(
  network: NetworkName,
  slot: number,
  timeout?: number
): Promise<CachedBeaconStateAllForks> {
  const config = getNetworkConfig(network);
  const fileId = `state_${network}_${slot}.ssz`;

  const filepath = path.join(testCachePath, fileId);
  let stateSsz: Uint8Array;
  if (fs.existsSync(filepath)) {
    stateSsz = fs.readFileSync(filepath);
  } else {
    const client = getClient({baseUrl: getInfuraBeaconUrl(network), timeoutMs: timeout ?? 300_000}, {config});
    stateSsz =
      computeEpochAtSlot(slot) < config.ALTAIR_FORK_EPOCH
        ? await client.debug.getState(String(slot), "ssz")
        : await client.debug.getStateV2(String(slot), "ssz");

    fs.writeFileSync(filepath, stateSsz);
  }

  const stateView = config.getForkTypes(slot).BeaconState.deserializeToViewDU(stateSsz);
  return createCachedBeaconStateTest(stateView, config);
}

/**
 * Download a state from Infura. Caches states in local fs by network and slot to only download once.
 */
export async function getNetworkCachedBlock(
  network: NetworkName,
  slot: number,
  timeout?: number
): Promise<allForks.SignedBeaconBlock> {
  const config = getNetworkConfig(network);
  const fileId = `block_${network}_${slot}.ssz`;

  const filepath = path.join(testCachePath, fileId);

  if (fs.existsSync(filepath)) {
    const blockSsz = fs.readFileSync(filepath);
    return config.getForkTypes(slot).SignedBeaconBlock.deserialize(blockSsz);
  } else {
    const client = getClient({baseUrl: getInfuraBeaconUrl(network), timeoutMs: timeout ?? 300_000}, {config});

    const res =
      computeEpochAtSlot(slot) < config.ALTAIR_FORK_EPOCH
        ? await client.beacon.getBlock(String(slot))
        : await client.beacon.getBlockV2(String(slot));
    const block = res.data;

    const blockSsz = config.getForkTypes(slot).SignedBeaconBlock.serialize(block);
    fs.writeFileSync(filepath, blockSsz);
    return block;
  }
}
