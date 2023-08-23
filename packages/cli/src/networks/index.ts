import fs from "node:fs";
import got from "got";
import {ENR} from "@chainsafe/discv5";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ApiError, getClient} from "@lodestar/api";
import {getStateTypeFromBytes} from "@lodestar/beacon-node";
import {ChainConfig, ChainForkConfig} from "@lodestar/config";
import {Checkpoint} from "@lodestar/types/phase0";
import {Slot} from "@lodestar/types";
import {fromHex, callFnWhenAwait, Logger} from "@lodestar/utils";
import {BeaconStateAllForks, getLatestBlockRoot, computeCheckpointEpochAtStateSlot} from "@lodestar/state-transition";
import {parseBootnodesFile} from "../util/format.js";
import * as mainnet from "./mainnet.js";
import * as dev from "./dev.js";
import * as gnosis from "./gnosis.js";
import * as goerli from "./goerli.js";
import * as ropsten from "./ropsten.js";
import * as sepolia from "./sepolia.js";
import * as holesky from "./holesky.js";
import * as chiado from "./chiado.js";

export type NetworkName = "mainnet" | "dev" | "gnosis" | "goerli" | "ropsten" | "sepolia" | "holesky" | "chiado";
export const networkNames: NetworkName[] = [
  "mainnet",
  "gnosis",
  "goerli",
  "ropsten",
  "sepolia",
  "holesky",
  "chiado",

  // Leave always as last network. The order matters for the --help printout
  "dev",
];

export function isKnownNetworkName(network: string): network is NetworkName {
  return networkNames.includes(network as NetworkName);
}

export type WeakSubjectivityFetchOptions = {
  weakSubjectivityServerUrl: string;
  weakSubjectivityCheckpoint?: string;
};

// log to screen every 30s when downloading state from a lodestar node
const GET_STATE_LOG_INTERVAL = 30 * 1000;

export function getNetworkData(network: NetworkName): {
  chainConfig: ChainConfig;
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
    case "holesky":
      return holesky;
    case "chiado":
      return chiado;
    default:
      throw Error(`Network not supported: ${network}`);
  }
}

export function getNetworkBeaconParams(network: NetworkName): ChainConfig {
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
  for (const enrStr of bootnodes) {
    try {
      ENR.decodeTxt(enrStr);
    } catch (e) {
      throw new Error(`Invalid ENR found in ${bootnodesFilePath}:\n    ${enrStr}`);
    }
  }

  if (bootnodes.length === 0) {
    throw new Error(`No bootnodes found on file ${bootnodesFilePath}`);
  }

  return bootnodes;
}

/**
 * Fetch weak subjectivity state from a remote beacon node
 */
export async function fetchWeakSubjectivityState(
  config: ChainForkConfig,
  logger: Logger,
  {checkpointSyncUrl, wssCheckpoint}: {checkpointSyncUrl: string; wssCheckpoint?: string}
): Promise<{wsState: BeaconStateAllForks; wsCheckpoint: Checkpoint}> {
  try {
    let wsCheckpoint: Checkpoint | null;
    let stateId: Slot | "finalized";

    const api = getClient({baseUrl: checkpointSyncUrl}, {config});
    if (wssCheckpoint) {
      wsCheckpoint = getCheckpointFromArg(wssCheckpoint);
      stateId = wsCheckpoint.epoch * SLOTS_PER_EPOCH;
    } else {
      // Fetch current finalized state and extract checkpoint from it
      stateId = "finalized";
      wsCheckpoint = null;
    }

    // getStateV2 should be available for all forks including phase0
    const getStatePromise = api.debug.getStateV2(stateId, "ssz");

    const stateBytes = await callFnWhenAwait(
      getStatePromise,
      () => logger.info("Download in progress, please wait..."),
      GET_STATE_LOG_INTERVAL
    ).then((res) => {
      ApiError.assert(res, "Can not fetch state from beacon node");
      return res.response;
    });

    logger.info("Download completed", {stateId});
    const wsState = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);

    return {
      wsState,
      wsCheckpoint: wsCheckpoint ?? getCheckpointFromState(wsState),
    };
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

export function getCheckpointFromState(state: BeaconStateAllForks): Checkpoint {
  return {
    // the correct checkpoint is based on state's slot, its latestBlockHeader's slot's epoch can be
    // behind the state
    epoch: computeCheckpointEpochAtStateSlot(state.slot),
    root: getLatestBlockRoot(state),
  };
}
