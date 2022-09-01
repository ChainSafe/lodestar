import fs from "node:fs";
import got from "got";
import {SLOTS_PER_EPOCH, ForkName} from "@lodestar/params";
import {getClient} from "@lodestar/api";
import {getStateTypeFromBytes} from "@lodestar/beacon-node";
import {IChainConfig, IChainForkConfig} from "@lodestar/config";
import {Checkpoint} from "@lodestar/types/phase0";
import {fromHex, callFnWhenAwait, ILogger} from "@lodestar/utils";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {parseBootnodesFile} from "../util/format.js";
import * as mainnet from "./mainnet.js";
import * as dev from "./dev.js";
import * as gnosis from "./gnosis.js";
import * as goerli from "./goerli.js";
import * as ropsten from "./ropsten.js";
import * as sepolia from "./sepolia.js";

export type NetworkName = "mainnet" | "dev" | "gnosis" | "goerli" | "ropsten" | "sepolia";
export const networkNames: NetworkName[] = [
  "mainnet",
  "gnosis",
  "goerli",
  "ropsten",
  "sepolia",

  // Leave always as last network. The order matters for the --help printout
  "dev",
];

export type WeakSubjectivityFetchOptions = {
  weakSubjectivityServerUrl: string;
  weakSubjectivityCheckpoint?: string;
};

// log to screen every 30s when downloading state from a lodestar node
const GET_STATE_LOG_INTERVAL = 30 * 1000;

export function getNetworkData(
  network: NetworkName
): {
  chainConfig: IChainConfig;
  depositContractDeployBlock: number;
  genesisFileUrl: string | null;
  bootnodesFileUrl: string | null;
  bootEnrs: string[];
} {
  switch (network) {
    case "mainnet":
      return mainnet;
    case "dev":
      return dev;
    case "gnosis":
      return gnosis;
    case "goerli":
      return goerli;
    case "ropsten":
      return ropsten;
    case "sepolia":
      return sepolia;
    default:
      throw Error(`Network not supported: ${network}`);
  }
}

export function getNetworkBeaconParams(network: NetworkName): IChainConfig {
  return getNetworkData(network).chainConfig;
}

/**
 * Get genesisStateFile URL to download. Returns null if not available
 */
export function getGenesisFileUrl(network: NetworkName): string | null {
  return getNetworkData(network).genesisFileUrl;
}

/**
 * Fetches the latest list of bootnodes for a network
 * Bootnodes file is expected to contain bootnode ENR's concatenated by newlines
 */
export async function fetchBootnodes(network: NetworkName): Promise<string[]> {
  const bootnodesFileUrl = getNetworkData(network).bootnodesFileUrl;
  if (bootnodesFileUrl === null) {
    return [];
  }

  const bootnodesFile = await got.get(bootnodesFileUrl).text();
  return parseBootnodesFile(bootnodesFile);
}

export async function getNetworkBootnodes(network: NetworkName): Promise<string[]> {
  const bootnodes = [...getNetworkData(network).bootEnrs];

  // Hidden option for testing
  if (!process.env.SKIP_FETCH_NETWORK_BOOTNODES) {
    try {
      const bootEnrs = await fetchBootnodes(network);
      bootnodes.push(...bootEnrs);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${(e as Error).stack}`);
    }
  }

  return bootnodes;
}

/**
 * Reads and parses a list of bootnodes for a network from a file.
 */
export function readBootnodes(bootnodesFilePath: string): string[] {
  const bootnodesFile = fs.readFileSync(bootnodesFilePath, "utf8");

  const bootnodes = parseBootnodesFile(bootnodesFile);

  if (bootnodes.length === 0) {
    throw new Error(`No bootnodes found on file ${bootnodesFilePath}`);
  }

  return bootnodes;
}

/**
 * Fetch weak subjectivity state from a remote beacon node
 */
export async function fetchWeakSubjectivityState(
  config: IChainForkConfig,
  logger: ILogger,
  {checkpointSyncUrl, wssCheckpoint}: {checkpointSyncUrl: string; wssCheckpoint?: string}
): Promise<{wsState: BeaconStateAllForks; wsCheckpoint: Checkpoint}> {
  try {
    let wsCheckpoint;
    const api = getClient({baseUrl: checkpointSyncUrl}, {config});
    if (wssCheckpoint) {
      wsCheckpoint = getCheckpointFromArg(wssCheckpoint);
    } else {
      const {
        data: {finalized},
      } = await api.beacon.getStateFinalityCheckpoints("head");
      wsCheckpoint = finalized;
    }
    const stateSlot = wsCheckpoint.epoch * SLOTS_PER_EPOCH;
    const getStatePromise =
      config.getForkName(stateSlot) === ForkName.phase0
        ? api.debug.getState(`${stateSlot}`, "ssz")
        : api.debug.getStateV2(`${stateSlot}`, "ssz");

    const stateBytes = await callFnWhenAwait(
      getStatePromise,
      () => logger.info("Download in progress, please wait..."),
      GET_STATE_LOG_INTERVAL
    );

    logger.info("Download completed");

    return {wsState: getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes), wsCheckpoint};
  } catch (e) {
    throw new Error("Unable to fetch weak subjectivity state: " + (e as Error).message);
  }
}

export function getCheckpointFromArg(checkpointStr: string): Checkpoint {
  const checkpointRegex = new RegExp("^(?:0x)?([0-9a-f]{64}):([0-9]+)$");
  const match = checkpointRegex.exec(checkpointStr.toLowerCase());
  if (!match) {
    throw new Error(`Could not parse checkpoint string: ${checkpointStr}`);
  }
  return {root: fromHex(match[1]), epoch: parseInt(match[2])};
}
