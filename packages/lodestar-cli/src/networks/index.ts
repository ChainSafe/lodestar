import got from "got";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {IBeaconParamsUnparsed} from "../config/types";
import * as pyrmont from "./pyrmont";
import * as mainnet from "./mainnet";

export type NetworkName = "pyrmont" | "mainnet";
export const networkNames: NetworkName[] = ["pyrmont", "mainnet"];

function getNetworkData(
  network: NetworkName
): {
  beaconParams: IBeaconParamsUnparsed;
  depositContractDeployBlock: number;
  genesisFileUrl: string | null;
  bootnodesFileUrl: string;
  bootEnrs: string[];
} {
  switch (network) {
    case "pyrmont":
      return pyrmont;
    case "mainnet":
      return mainnet;
    default:
      throw Error(`Network not supported: ${network}`);
  }
}

export function getNetworkBeaconParams(network: NetworkName): IBeaconParamsUnparsed {
  return getNetworkData(network).beaconParams;
}

export function getNetworkBeaconNodeOptions(network: NetworkName): RecursivePartial<IBeaconNodeOptions> {
  const {depositContractDeployBlock, bootEnrs} = getNetworkData(network);
  return {
    api: {rest: {enabled: true}},
    eth1: {
      providerUrl:
        network === "mainnet"
          ? "https://mainnet.infura.io/v3/84842078b09946638c03157f83405213"
          : "https://goerli.prylabs.net",
      depositContractDeployBlock,
    },
    metrics: {enabled: true},
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
  return (
    bootnodesFile
      .trim()
      .split(/\r?\n/)
      // File may contain a row with '### Ethereum Node Records'
      .filter((enr) => enr.trim() && enr.startsWith("enr:"))
  );
}
