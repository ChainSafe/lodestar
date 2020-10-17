import got from "got";
import {IBeaconNodeOptionsPartial} from "../options";
import {altonaConfig} from "./altona";
import {medallaConfig} from "./medalla";
import {spadinaConfig} from "./spadina";
import {zinkenConfig} from "./zinken";

export type TestnetName = "altona" | "medalla" | "spadina" | "zinken";
export const testnetNames: TestnetName[] = ["altona", "medalla", "spadina", "zinken"];

export function getTestnetConfig(testnet: TestnetName): IBeaconNodeOptionsPartial {
  switch (testnet) {
    case "altona":
      return altonaConfig;
    case "medalla":
      return medallaConfig;
    case "spadina":
      return spadinaConfig;
    case "zinken":
      return zinkenConfig;
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

export function getTestnetParamsUrl(testnet: TestnetName): string | null {
  switch (testnet) {
    case "altona":
      return "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/altona/config.yaml";
    case "medalla":
      return "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/medalla/config.yaml";
    case "spadina":
      return "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/spadina/config.yaml";
    case "zinken":
      return "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/zinken/config.yaml";
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

/**
 * Get genesisStateFile URL to download. Returns null if not available
 */
export function getGenesisFileUrl(testnet: TestnetName): string | null {
  switch (testnet) {
    case "altona":
      // eslint-disable-next-line max-len
      return "https://github.com/eth2-clients/eth2-testnets/raw/b84d27cc8f161cc6289c91acce6dae9c35096845/shared/altona/genesis.ssz";
    case "medalla":
      return "https://github.com/eth2-clients/eth2-testnets/blob/master/shared/medalla/genesis.ssz?raw=true";
    case "spadina":
      return null; // TODO: add genesis.ssz file here
    case "zinken":
      return null; // TODO: add genesis.ssz file here
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

function getBootnodesFileUrl(testnet: TestnetName): string {
  switch (testnet) {
    case "altona":
      return "https://github.com/eth2-clients/eth2-testnets/raw/master/shared/altona/bootstrap_nodes.txt";
    case "medalla":
      return "https://github.com/goerli/medalla/raw/master/medalla/bootnodes.txt";
    case "spadina":
      return "https://github.com/goerli/medalla/raw/master/spadina/bootnodes.txt";
    case "zinken":
      return "https://github.com/goerli/medalla/raw/master/zinken/bootnodes.txt";
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

/**
 * Fetches the latest list of bootnodes for a testnet
 * Bootnodes file is expected to contain bootnode ENR's concatenated by newlines
 * @param testnet
 */
export async function fetchBootnodes(testnet: TestnetName): Promise<string[]> {
  const bootnodesFileUrl = getBootnodesFileUrl(testnet);
  const bootnodesFile = await got.get(bootnodesFileUrl).text();
  return (
    bootnodesFile
      .trim()
      .split(/\r?\n/)
      // File may contain a row with '### Ethereum Node Records'
      .filter((enr) => enr.trim() && enr.startsWith("enr:"))
  );
}
