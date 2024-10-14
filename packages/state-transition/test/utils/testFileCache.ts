import fs from "node:fs";
import path from "node:path";
import got from "got";
import {getClient} from "@lodestar/api";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {createChainForkConfig, ChainForkConfig} from "@lodestar/config";
import {SignedBeaconBlock} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "../../src/index.js";
import {testCachePath} from "../cache.js";
import {createCachedBeaconStateTest} from "../utils/state.js";
import {getInfuraBeaconUrl} from "./infura.js";

/**
 * Full link example:
 * ```
 * https://github.com/dapplion/ethereum-consensus-test-data/releases/download/v0.1.0/block_mainnet_3766821.ssz
 * ``` */
const TEST_FILES_BASE_URL = "https://github.com/dapplion/ethereum-consensus-test-data/releases/download/v0.1.0";

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
export async function getNetworkCachedState(
  network: NetworkName,
  slot: number,
  timeout?: number
): Promise<CachedBeaconStateAllForks> {
  const config = getNetworkConfig(network);
  const fileId = `state_${network}_${slot}.ssz`;

  const filepath = path.join(testCachePath, fileId);

  if (fs.existsSync(filepath)) {
    const stateSsz = fs.readFileSync(filepath);
    return createCachedBeaconStateTest(config.getForkTypes(slot).BeaconState.deserializeToViewDU(stateSsz), config);
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
  return createCachedBeaconStateTest(config.getForkTypes(slot).BeaconState.deserializeToViewDU(stateSsz), config);
}

/**
 * Download a state from Infura. Caches states in local fs by network and slot to only download once.
 */
export async function getNetworkCachedBlock(
  network: NetworkName,
  slot: number,
  timeout?: number
): Promise<SignedBeaconBlock> {
  const config = getNetworkConfig(network);
  const fileId = `block_${network}_${slot}.ssz`;

  const filepath = path.join(testCachePath, fileId);

  if (fs.existsSync(filepath)) {
    const blockSsz = fs.readFileSync(filepath);
    return config.getForkTypes(slot).SignedBeaconBlock.deserialize(blockSsz);
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
  return config.getForkTypes(slot).SignedBeaconBlock.deserialize(blockSsz);
}

async function downloadTestFile(fileId: string): Promise<Buffer> {
  const fileUrl = `${TEST_FILES_BASE_URL}/${fileId}`;
  console.log(`Downloading file ${fileUrl}`);

  const res = await got(fileUrl, {responseType: "buffer"}).catch((e: Error) => {
    e.message = `Error downloading ${fileUrl}: ${e.message}`;
    throw e;
  });
  return res.body;
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
