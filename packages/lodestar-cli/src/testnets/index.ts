import got from "got";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {IBeaconParamsUnparsed} from "../config/types";
import {RecursivePartial} from "../util";
import * as altona from "./altona";
import * as medalla from "./medalla";
import * as spadina from "./spadina";
import * as zinken from "./zinken";
import * as pyrmont from "./pyrmont";

export type TestnetName = "altona" | "medalla" | "spadina" | "zinken" | "pyrmont";
export const testnetNames: TestnetName[] = ["altona", "medalla", "spadina", "zinken", "pyrmont"];

function getTestnetData(
  testnet: TestnetName
): {
  beaconParams: IBeaconParamsUnparsed;
  depositContractDeployBlock: number;
  genesisFileUrl: string | null;
  bootnodesFileUrl: string;
  bootEnrs: string[];
} {
  switch (testnet) {
    case "altona":
      return altona;
    case "medalla":
      return medalla;
    case "spadina":
      return spadina;
    case "zinken":
      return zinken;
    case "pyrmont":
      return pyrmont;
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

export function getTestnetBeaconParams(testnet: TestnetName): IBeaconParamsUnparsed {
  return getTestnetData(testnet).beaconParams;
}

export function getTestnetBeaconNodeOptions(testnet: TestnetName): RecursivePartial<IBeaconNodeOptions> {
  const {depositContractDeployBlock, bootEnrs} = getTestnetData(testnet);
  return {
    api: {rest: {enabled: true}},
    eth1: {providerUrl: "https://goerli.prylabs.net", depositContractDeployBlock},
    metrics: {enabled: true},
    network: {
      discv5: {
        // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
        // @ts-ignore
        enabled: true,
        bootEnrs,
      },
    },
  };
}

/**
 * Get genesisStateFile URL to download. Returns null if not available
 */
export function getGenesisFileUrl(testnet: TestnetName): string | null {
  return getTestnetData(testnet).genesisFileUrl;
}

/**
 * Fetches the latest list of bootnodes for a testnet
 * Bootnodes file is expected to contain bootnode ENR's concatenated by newlines
 */
export async function fetchBootnodes(testnet: TestnetName): Promise<string[]> {
  const bootnodesFileUrl = getTestnetData(testnet).bootnodesFileUrl;
  const bootnodesFile = await got.get(bootnodesFileUrl).text();
  return (
    bootnodesFile
      .trim()
      .split(/\r?\n/)
      // File may contain a row with '### Ethereum Node Records'
      .filter((enr) => enr.trim() && enr.startsWith("enr:"))
  );
}
