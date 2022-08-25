import fs from "node:fs";
import got from "got";
import {SLOTS_PER_EPOCH, ForkName} from "@lodestar/params";
import {getClient} from "@lodestar/api";
import {IBeaconNodeOptions, getStateTypeFromBytes} from "@lodestar/beacon-node";
import {IChainConfig, IChainForkConfig} from "@lodestar/config";
import {Checkpoint} from "@lodestar/types/phase0";
import {RecursivePartial, fromHex, callFnWhenAwait, ILogger} from "@lodestar/utils";
import {BeaconStateAllForks} from "@lodestar/state-transition";
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

function getNetworkData(
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

export function getNetworkBeaconNodeOptions(network: NetworkName): RecursivePartial<IBeaconNodeOptions> {
  const {depositContractDeployBlock, bootEnrs} = getNetworkData(network);
  return {
    eth1: {
      depositContractDeployBlock,
    },
    network: {
      discv5: {
        enabled: true,
        bootEnrs,
      },
    },
  };
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

  const enrs: string[] = [];
  for (const line of bootnodesFile.trim().split(/\r?\n/)) {
    // File may contain a row with '### Ethereum Node Records'
    // File may be YAML, with `- enr:-KG4QOWkRj`
    if (line.includes("enr:")) enrs.push("enr:" + line.split("enr:")[1]);
  }
  return enrs;
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
 * Parses a file to get a list of bootnodes for a network.
 * Bootnodes file is expected to contain bootnode ENR's concatenated by newlines, or commas for
 * parsing plaintext, YAML, JSON and/or env files.
 */
export function parseBootnodesFile(bootnodesFile: string): string[] {
  const enrs = [];
  for (const line of bootnodesFile.trim().split(/\r?\n/)) {
    for (const entry of line.split(",")) {
      const sanitizedEntry = entry.replace(/['",[\]{}.]+/g, "").trim();

      if (sanitizedEntry.includes("enr:-")) {
        const parsedEnr = `enr:-${sanitizedEntry.split("enr:-")[1]}`;
        enrs.push(parsedEnr);
      }
    }
  }
  return enrs;
}

/**
 * Parses a file to get a list of bootnodes for a network if given a valid path,
 * and returns the bootnodes in an "injectable" network options format.
 */
export function getInjectableBootEnrs(bootnodesFilepath: string): RecursivePartial<IBeaconNodeOptions> {
  const bootEnrs = readBootnodes(bootnodesFilepath);
  const injectableBootEnrs = enrsToNetworkConfig(bootEnrs);

  return injectableBootEnrs;
}

/**
 * Given an array of bootnodes, returns them in an injectable format
 */
export function enrsToNetworkConfig(enrs: string[]): RecursivePartial<IBeaconNodeOptions> {
  return {network: {discv5: {bootEnrs: enrs}}};
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
