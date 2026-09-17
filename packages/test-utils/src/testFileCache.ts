import fs from "node:fs";
import path from "node:path";
import {getClient} from "@lodestar/api";
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
  cacheDir: string,
  timeout?: number
): Promise<NetworkCachedBytes> {
  const config = getNetworkConfig(network);
  const fileId = `state_${network}_${slot}.ssz`;

  const filepath = path.join(cacheDir, fileId);

  if (fs.existsSync(filepath)) {
    const stateSsz = fs.readFileSync(filepath);
    return {config, bytes: stateSsz};
  }

  const stateSsz = await tryEach([
    () => downloadTestFile(fileId),
    () => {
      const client = getClient(
        {baseUrl: getInfuraBeaconUrl(network), globalInit: {timeoutMs: timeout ?? 300_000}},
        {config}
      );
      return client.debug.getStateV2({stateId: slot}).then((r) => {
        return r.ssz();
      });
    },
  ]);

  fs.writeFileSync(filepath, stateSsz);
  return {config, bytes: stateSsz};
}

/**
 * Download a state from Infura. Caches states in local fs by network and slot to only download once.
 */
export async function getNetworkCachedBlockBytes(
  network: NetworkName,
  slot: number,
  cacheDir: string,
  timeout?: number
): Promise<NetworkCachedBytes> {
  const config = getNetworkConfig(network);
  const fileId = `block_${network}_${slot}.ssz`;

  const filepath = path.join(cacheDir, fileId);

  if (fs.existsSync(filepath)) {
    const blockSsz = fs.readFileSync(filepath);
    return {config, bytes: blockSsz};
  }

  const blockSsz = await tryEach([
    () => downloadTestFile(fileId),
    async () => {
      const client = getClient(
        {baseUrl: getInfuraBeaconUrl(network), globalInit: {timeoutMs: timeout ?? 300_000}},
        {config}
      );

      return (await client.beacon.getBlockV2({blockId: slot})).ssz();
    },
  ]);

  fs.writeFileSync(filepath, blockSsz);
  return {config, bytes: blockSsz};
}

async function downloadTestFile(fileId: string): Promise<Uint8Array> {
  const fileUrl = `${TEST_FILES_BASE_URL}/${fileId}`;
  console.log(`Downloading file ${fileUrl}`);

  try {
    const res = await fetch(fileUrl);
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

function getInfuraBeaconUrl(network: NetworkName): string {
  const credentials = process.env.INFURA_ETH2_CREDENTIALS;
  if (!credentials) {
    throw Error("Must set ENV INFURA_ETH2_CREDENTIALS");
  }

  return `https://${credentials}@eth2-beacon-${network}.infura.io`;
}

async function tryEach<T>(promises: (() => Promise<T>)[]): Promise<T> {
  const errors: Error[] = [];

  for (let i = 0; i < promises.length; i++) {
    try {
      return await promises[i]();
    } catch (e) {
      errors.push(e as Error);
    }
  }

  throw Error(errors.map((e, i) => `Error[${i}] ${e.message}`).join("\n"));
}
