import fs from "node:fs";
import path from "node:path";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {fetch} from "@lodestar/utils";

/**
 * Full link example:
 * ```
 * https://github.com/dapplion/ethereum-consensus-test-data/releases/download/v0.1.0/block_mainnet_3766821.ssz
 * ``` */
const TEST_FILES_BASE_URL = "https://github.com/dapplion/ethereum-consensus-test-data/releases/download/v0.1.0";

type NetworkCachedBytes = {
  config: ChainForkConfig;
  bytes: Uint8Array;
};

/**
 * Create a network config from known network params
 */
export function getNetworkConfig(network: NetworkName): ChainForkConfig {
  const configNetwork = networksChainConfig[network];
  return createChainForkConfig(configNetwork);
}

/**
 * Download a state from Infura. Caches states in local fs by network and slot to only download once.
 */
export async function getNetworkCachedStateBytes(
  network: NetworkName,
  slot: number,
  cacheDir: string
): Promise<NetworkCachedBytes> {
  const config = getNetworkConfig(network);
  const fileId = `state_${network}_${slot}.ssz`;

  const filepath = path.join(cacheDir, fileId);

  if (fs.existsSync(filepath)) {
    const stateSsz = fs.readFileSync(filepath);
    return {config, bytes: stateSsz};
  }

  const stateSsz = await downloadTestFile(fileId);

  fs.writeFileSync(filepath, stateSsz);
  return {config, bytes: stateSsz};
}

/**
 * Download a state from Infura. Caches states in local fs by network and slot to only download once.
 */
export async function getNetworkCachedBlockBytes(
  network: NetworkName,
  slot: number,
  cacheDir: string
): Promise<NetworkCachedBytes> {
  const config = getNetworkConfig(network);
  const fileId = `block_${network}_${slot}.ssz`;

  const filepath = path.join(cacheDir, fileId);

  if (fs.existsSync(filepath)) {
    const blockSsz = fs.readFileSync(filepath);
    return {config, bytes: blockSsz};
  }

  const blockSsz = await downloadTestFile(fileId);

  fs.writeFileSync(filepath, blockSsz);
  return {config, bytes: blockSsz};
}

async function downloadTestFile(fileId: string): Promise<Uint8Array> {
  const fileUrl = `${TEST_FILES_BASE_URL}/${fileId}`;
  console.log(`Downloading file ${fileUrl}`);

  try {
    const res = await fetch(fileUrl, {signal: AbortSignal.timeout(4 * 60 * 1000)});
    if (!res.ok) {
      throw new Error(`Error downloading ${fileUrl}: ${res.status} ${res.statusText}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    const error = e as Error;
    error.message = `Error downloading ${fileUrl}: ${error.message}`;
    throw error;
  }
}
