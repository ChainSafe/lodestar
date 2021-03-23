import got from "got";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {IBeaconParamsUnparsed} from "../config/types";
import * as mainnet from "./mainnet";
import * as pyrmont from "./pyrmont";
import * as prater from "./prater";

export type NetworkName = "mainnet" | "pyrmont" | "prater" | "dev";
export const networkNames: NetworkName[] = ["mainnet", "pyrmont", "prater"];

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

export function getEth1ProviderUrl(networkId: number): string {
  switch (networkId) {
    case 1:
      return "https://mainnet.infura.io/v3/84842078b09946638c03157f83405213";
    case 5:
      return "https://goerli.infura.io/v3/84842078b09946638c03157f83405213";
    default:
      throw Error(`Eth1 network not supported: ${networkId}`);
  }
}

export function getNetworkBeaconParams(network: NetworkName): IBeaconParamsUnparsed {
  return getNetworkData(network).beaconParams;
}

export function getNetworkBeaconNodeOptions(network: NetworkName): RecursivePartial<IBeaconNodeOptions> {
  const {depositContractDeployBlock, bootEnrs, beaconParams} = getNetworkData(network);
  const networkId = parseInt((beaconParams.DEPOSIT_NETWORK_ID || 1) as string, 10);
  return {
    api: {rest: {enabled: true}},
    eth1: {
      providerUrl: getEth1ProviderUrl(networkId),
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
