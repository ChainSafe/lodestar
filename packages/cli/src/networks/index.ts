import fs from "node:fs";
import {ENR} from "@chainsafe/enr";
import {WireFormat, getClient} from "@lodestar/api";
import {getStateSlotFromBytes} from "@lodestar/beacon-node";
import {ChainConfig, ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {LodestarError, Logger, callFnWhenAwait, fetch, formatBytes, fromHex} from "@lodestar/utils";
import {parseBootnodesFile} from "../util/format.js";
import * as chiado from "./chiado.js";
import * as dev from "./dev.js";
import * as ephemery from "./ephemery.js";
import * as gnosis from "./gnosis.js";
import * as hoodi from "./hoodi.js";
import * as mainnet from "./mainnet.js";
import * as plataberget from "./plataberget.js";
import * as sepolia from "./sepolia.js";

export type NetworkName = "mainnet" | "dev" | "gnosis" | "sepolia" | "hoodi" | "plataberget" | "chiado" | "ephemery";
export const networkNames: NetworkName[] = [
  "mainnet",
  "gnosis",
  "sepolia",
  "hoodi",
  "plataberget",
  "chiado",
  "ephemery",

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
  genesisFileUrl: string | null;
  genesisStateRoot: string | null;
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
    case "sepolia":
      return sepolia;
    case "hoodi":
      return hoodi;
    case "plataberget":
      return plataberget;
    case "chiado":
      return chiado;
    case "ephemery":
      return ephemery;
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
 * Get expected genesisStateRoot for validation. Returns null if not available.
 * For example, this returns null for Ephemery, since its genesis state root
 * changes with each iteration and we don't know the permanent state root.
 */
export function getGenesisStateRoot(network: NetworkName | undefined): string | null {
  if (!network) {
    return null;
  }
  return getNetworkData(network).genesisStateRoot;
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

  const res = await fetch(bootnodesFileUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch bootnodes: ${res.status} ${res.statusText}`);
  }
  const bootnodesFile = await res.text();
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
    } catch (_e) {
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
export async function fetchWeakSubjectivityStateBytes(
  config: ChainForkConfig,
  logger: Logger,
  {checkpointSyncUrl, wssCheckpoint}: {checkpointSyncUrl: string; wssCheckpoint?: string}
): Promise<{stateBytes: Uint8Array; expectedCheckpoint: Checkpoint | null}> {
  try {
    let wsCheckpoint: Checkpoint | null;
    let stateId: Slot | "finalized";

    const api = getClient({baseUrl: checkpointSyncUrl}, {config});
    if (wssCheckpoint) {
      wsCheckpoint = getCheckpointFromArg(wssCheckpoint);
      stateId = wsCheckpoint.epoch * SLOTS_PER_EPOCH;
    } else {
      // Checkpoint identity can be derived after the selected state is constructed.
      stateId = "finalized";
      wsCheckpoint = null;
    }

    // getStateV2 should be available for all forks including phase0
    const getStatePromise = api.debug.getStateV2({stateId}, {responseWireFormat: WireFormat.ssz});

    const response = await callFnWhenAwait(
      getStatePromise,
      () => logger.info("Download in progress, please wait..."),
      GET_STATE_LOG_INTERVAL
    );
    const wsStateBytes = response.ssz();
    const {version} = response.meta();

    const wsSlot = getStateSlotFromBytes(wsStateBytes);
    const logData = {stateId, size: formatBytes(wsStateBytes.length)};
    logger.info("Download completed", typeof stateId === "number" ? logData : {...logData, slot: wsSlot});

    const expectedFork = config.getForkName(wsSlot);
    if (version !== expectedFork) {
      throw new LodestarError(
        {code: "CHECKPOINT_FORK_MISMATCH"},
        `Checkpoint sync server returned ${version} state at slot ${wsSlot} but local config expects ${expectedFork}, verify --network or the chain config`
      );
    }

    return {
      stateBytes: new Uint8Array(wsStateBytes.buffer, wsStateBytes.byteOffset, wsStateBytes.byteLength),
      expectedCheckpoint: wsCheckpoint,
    };
  } catch (e) {
    const error = new LodestarError(
      {code: "CHECKPOINT_DOWNLOAD_FAILED"},
      "Unable to fetch weak subjectivity state: " + (e as Error).message
    );
    error.cause = e;
    throw error;
  }
}

export function getCheckpointFromArg(checkpointStr: string): Checkpoint {
  const checkpointRegex = /^(?:0x)?([0-9a-f]{64}):([0-9]+)$/;
  const match = checkpointRegex.exec(checkpointStr.toLowerCase());
  if (!match) {
    throw new LodestarError({code: "INVALID_CHECKPOINT"}, `Could not parse checkpoint string: ${checkpointStr}`);
  }
  return {root: fromHex(match[1]), epoch: parseInt(match[2])};
}
