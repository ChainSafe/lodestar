import fs from "fs";
import path from "path";
import stream from "stream";
import {promisify} from "util";
import got from "got";
import {IBeaconNodeOptionsPartial} from "../../../options";
import {altonaConfig} from "./altona";
import {medallaConfig} from "./medalla";

export type TestnetName = "altona" | "medalla";

export function getTestnetConfig(testnet: TestnetName): IBeaconNodeOptionsPartial {
  switch (testnet) {
    case "altona":
      return altonaConfig;
    case "medalla":
      return medallaConfig;
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
      return null;
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
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

/**
 * Downloads a genesis file per testnet if it does not exist
 */
export async function downloadGenesisFile(filepath: string, url: string): Promise<void> {
  if (!fs.existsSync(filepath)) {
    fs.mkdirSync(path.parse(filepath).dir, {recursive: true});
    await promisify(stream.pipeline)(
      got.stream(url),
      fs.createWriteStream(filepath)
    );
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
  return bootnodesFile
    .trim()
    .split(/\r?\n/)
    // File may contain a row with '### Ethereum Node Records'
    .filter(enr => enr.trim() && enr.startsWith("enr:"));
}