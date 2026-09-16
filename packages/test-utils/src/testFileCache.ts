import fs from "node:fs";
import path from "node:path";
import {getClient} from "@lodestar/api";
import {type ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {fetch} from "@lodestar/utils";

const TEST_FILES_BASE_URL = "https://github.com/dapplion/ethereum-consensus-test-data/releases/download/v0.1.0";

type NetworkCachedBytes = {
  config: ChainForkConfig;
  bytes: Uint8Array;
};

export async function getNetworkCachedStateBytes(
  network: NetworkName,
  slot: number,
  cacheDir: string,
  timeout?: number
): Promise<NetworkCachedBytes> {
  const config = createChainForkConfig(networksChainConfig[network]);
  const fileId = `state_${network}_${slot}.ssz`;
  const bytes = await getCachedFile(fileId, cacheDir, () => {
    const client = getClient(
      {baseUrl: getInfuraBeaconUrl(network), globalInit: {timeoutMs: timeout ?? 300_000}},
      {config}
    );
    return client.debug.getStateV2({stateId: slot}).then((response) => response.ssz());
  });

  return {config, bytes};
}

export async function getNetworkCachedBlockBytes(
  network: NetworkName,
  slot: number,
  cacheDir: string,
  timeout?: number
): Promise<NetworkCachedBytes> {
  const config = createChainForkConfig(networksChainConfig[network]);
  const fileId = `block_${network}_${slot}.ssz`;
  const bytes = await getCachedFile(fileId, cacheDir, async () => {
    const client = getClient(
      {baseUrl: getInfuraBeaconUrl(network), globalInit: {timeoutMs: timeout ?? 300_000}},
      {config}
    );
    return (await client.beacon.getBlockV2({blockId: slot})).ssz();
  });

  return {config, bytes};
}

async function getCachedFile(
  fileId: string,
  cacheDir: string,
  fallback: () => Promise<Uint8Array>
): Promise<Uint8Array> {
  const filepath = path.join(cacheDir, fileId);
  if (fs.existsSync(filepath)) {
    return fs.readFileSync(filepath);
  }

  const bytes = await tryEach([() => downloadTestFile(fileId), fallback]);
  fs.writeFileSync(filepath, bytes);
  return bytes;
}

async function downloadTestFile(fileId: string): Promise<Uint8Array> {
  const fileUrl = `${TEST_FILES_BASE_URL}/${fileId}`;
  console.log(`Downloading file ${fileUrl}`);

  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Error downloading ${fileUrl}: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    const downloadError = error as Error;
    downloadError.message = `Error downloading ${fileUrl}: ${downloadError.message}`;
    throw downloadError;
  }
}

function getInfuraBeaconUrl(network: NetworkName): string {
  const credentials = process.env.INFURA_ETH2_CREDENTIALS;
  if (!credentials) {
    throw Error("Must set ENV INFURA_ETH2_CREDENTIALS");
  }

  return `https://${credentials}@eth2-beacon-${network}.infura.io`;
}

async function tryEach<T>(tasks: (() => Promise<T>)[]): Promise<T> {
  const errors: Error[] = [];

  for (const task of tasks) {
    try {
      return await task();
    } catch (error) {
      errors.push(error as Error);
    }
  }

  throw Error(errors.map((error, index) => `Error[${index}] ${error.message}`).join("\n"));
}
