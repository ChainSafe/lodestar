import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {IChainConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
// eslint-disable-next-line no-restricted-imports
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {TreeBacked} from "@chainsafe/ssz";
import fs from "fs";
import got from "got";
import * as mainnet from "./mainnet";
import * as prater from "./prater";
import * as pyrmont from "./pyrmont";

export type NetworkName = "mainnet" | "pyrmont" | "prater" | "dev";
export const networkNames: NetworkName[] = ["mainnet", "pyrmont", "prater"];

function getNetworkData(
  network: NetworkName
): {
  chainConfig: IChainConfig;
  depositContractDeployBlock: number;
  genesisFileUrl: string | null;
  bootnodesFileUrl: string;
  bootEnrs: string[];
} {
  switch (network) {
    case "mainnet":
      return mainnet;
    case "pyrmont":
      return pyrmont;
    case "prater":
      return prater;
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
 * Reads a list of bootnodes for a network from a file.
 */
export async function readBootnodes(bootnodesFilePath: string): Promise<string[]> {
  if (!fs.existsSync(bootnodesFilePath)) {
    // eslint-disable-next-line no-console
    console.error("Bootnode file not found. Using default bootnodes.");
    return [];
  }
  const bootnodesFile = fs.readFileSync(bootnodesFilePath, "utf8");

  return parseBootnodesFile(bootnodesFile);
}

/**
 * Parses a file to get a list of bootnodes for a network.
 * Bootnodes file is expected to contain bootnode ENR's concatenated by newlines
 */
export function parseBootnodesFile(bootnodesFile: string): string[] {
  const enrs = [];
  for (const line of bootnodesFile.trim().split(/\r?\n/)) {
    for (const entry of line.split(",")) {
      if (entry.includes("enr:")) {
        const parsedEnr = `enr:${entry.split("enr:")[1]}`.replace(/['",[\]{}@.+]+/g, "");
        enrs.push(parsedEnr);
      }
    }
  }
  return enrs;
}

export function enrsToNetworkConfig(enrs: string[]): RecursivePartial<IBeaconNodeOptions> {
  if (enrs.length === 0) {
    return {};
  }

  return {network: {discv5: {bootEnrs: enrs}}};
}

export async function getInjectableBootEnrs(
  bootnodesFilepath: string | undefined
): Promise<RecursivePartial<IBeaconNodeOptions>> {
  const bootEnrs = bootnodesFilepath ? await readBootnodes(bootnodesFilepath) : [];
  const injectableBootEnrs = enrsToNetworkConfig(bootEnrs);

  return injectableBootEnrs;
}

/**
 * Fetch weak subjectivity state from a remote beacon node
 */
export async function fetchWeakSubjectivityState(
  config: IChainForkConfig,
  url: string
): Promise<TreeBacked<allForks.BeaconState>> {
  try {
    const response = await got(url, {headers: {accept: "application/octet-stream"}});
    const stateBytes = response.rawBody;
    return getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes);
  } catch (e) {
    throw new Error("Unable to fetch weak subjectivity state: " + (e as Error).message);
  }
}
