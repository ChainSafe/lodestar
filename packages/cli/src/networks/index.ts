import {SLOTS_PER_EPOCH, ForkName} from "@chainsafe/lodestar-params";
import {getClient} from "@chainsafe/lodestar-api";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {IChainConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {RecursivePartial, fromHex} from "@chainsafe/lodestar-utils";
// eslint-disable-next-line no-restricted-imports
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {TreeBacked} from "@chainsafe/ssz";
import fs from "node:fs";
import got from "got";
import * as mainnet from "./mainnet";
import * as prater from "./prater";
import * as kintsugi from "./kintsugi";

export type NetworkName = "mainnet" | "prater" | "kintsugi" | "dev";
export const networkNames: NetworkName[] = ["mainnet", "prater", "kintsugi"];

export type WeakSubjectivityFetchOptions = {
  weakSubjectivityServerUrl: string;
  weakSubjectivityCheckpoint?: string;
};

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
    case "prater":
      return prater;
    case "kintsugi":
      return kintsugi;
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
  {weakSubjectivityServerUrl, weakSubjectivityCheckpoint}: WeakSubjectivityFetchOptions
): Promise<{wsState: TreeBacked<allForks.BeaconState>; wsCheckpoint: Checkpoint}> {
  try {
    let wsCheckpoint;
    const api = getClient(config, {baseUrl: weakSubjectivityServerUrl});
    if (weakSubjectivityCheckpoint) {
      wsCheckpoint = getCheckpointFromArg(weakSubjectivityCheckpoint);
    } else {
      const {
        data: {finalized},
      } = await api.beacon.getStateFinalityCheckpoints("head");
      wsCheckpoint = finalized;
    }
    const stateSlot = wsCheckpoint.epoch * SLOTS_PER_EPOCH;
    const stateBytes = await (config.getForkName(stateSlot) === ForkName.phase0
      ? api.debug.getState(`${stateSlot}`, "ssz")
      : api.debug.getStateV2(`${stateSlot}`, "ssz"));

    return {wsState: getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes), wsCheckpoint};
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
