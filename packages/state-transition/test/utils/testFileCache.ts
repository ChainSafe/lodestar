import fs from "node:fs";
import path from "node:path";
import got from "got";
import {ApiError, getClient} from "@lodestar/api";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {createChainForkConfig, ChainForkConfig} from "@lodestar/config";
import {allForks} from "@lodestar/types";
import {CachedBeaconStateAllForks, computeEpochAtSlot} from "../../src/index.js";
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
  } else {
    const stateSsz = await tryEach([
      () => downloadTestFile(fileId),
      () => {
        const client = getClient({baseUrl: getInfuraBeaconUrl(network), timeoutMs: timeout ?? 300_000}, {config});
        return computeEpochAtSlot(slot) < config.ALTAIR_FORK_EPOCH
          ? client.debug.getState(String(slot), "ssz").then((r) => {
              ApiError.assert(r);
              return r.response;
            })
          : client.debug.getStateV2(String(slot), "ssz").then((r) => {
              ApiError.assert(r);
              return r.response;
            });
      },
    ]);

    fs.writeFileSync(filepath, stateSsz);
    return createCachedBeaconStateTest(config.getForkTypes(slot).BeaconState.deserializeToViewDU(stateSsz), config);
  }
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
    const blockSsz = await tryEach([
      () => downloadTestFile(fileId),
      async () => {
        const client = getClient({baseUrl: getInfuraBeaconUrl(network), timeoutMs: timeout ?? 300_000}, {config});

        const res =
          computeEpochAtSlot(slot) < config.ALTAIR_FORK_EPOCH
            ? await client.beacon.getBlock(String(slot))
            : await client.beacon.getBlockV2(String(slot));
        ApiError.assert(res);
        return config.getForkTypes(slot).SignedBeaconBlock.serialize(res.response.data);
      },
    ]);

    fs.writeFileSync(filepath, blockSsz);
    return config.getForkTypes(slot).SignedBeaconBlock.deserialize(blockSsz);
  }
}

async function downloadTestFile(fileId: string): Promise<Buffer> {
  const fileUrl = `${TEST_FILES_BASE_URL}/${fileId}`;
  // eslint-disable-next-line no-console
  console.log(`Downloading file ${fileUrl}`);

  const res = await got(fileUrl, {responseType: "buffer"});
  return res.body;
}

async function tryEach<T>(promises: (() => Promise<T>)[]): Promise<T> {
  const errors: Error[] = [];

  for (let i = 0; i < promises.length; i++) {
    try {
      return promises[i]();
    } catch (e) {
      errors.push(e as Error);
    }
  }

  throw Error(errors.map((e, i) => `Error[${i}] ${e.message}`).join("\n"));
}
