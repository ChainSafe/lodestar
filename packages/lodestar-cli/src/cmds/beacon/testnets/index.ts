import fs from "fs";
import path from "path";
import stream from "stream";
import {promisify} from "util";
import got from "got";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";

export type TestnetName = "altona";

export function getTestnetConfig(testnet: TestnetName): Partial<IBeaconNodeOptions> {
  switch (testnet) {
    case "altona":
      return JSON.parse(fs.readFileSync(path.join(__dirname, "altona.json"), "utf8"));
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

function getGenesisFileUrl(testnet: TestnetName): string {
  switch (testnet) {
    case "altona":
      // eslint-disable-next-line max-len
      return "https://github.com/eth2-clients/eth2-testnets/raw/b84d27cc8f161cc6289c91acce6dae9c35096845/shared/altona/genesis.ssz";
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

function getBootnodesFileUrl(testnet: TestnetName): string {
  switch (testnet) {
    case "altona":
      return "https://github.com/eth2-clients/eth2-testnets/raw/master/shared/altona/bootstrap_nodes.txt";
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

/**
 * Downloads a genesis file per testnet if it does not exist
 * @param options
 */
export async function downloadGenesisFile(
  testnet: TestnetName,
  genesisFilePath: string
): Promise<void> {
  const genesisFileUrl = getGenesisFileUrl(testnet);

  if (!fs.existsSync(genesisFilePath)) {
    fs.mkdirSync(path.parse(genesisFilePath).dir, {recursive: true});
    await promisify(stream.pipeline)(
      got.stream(genesisFileUrl),
      fs.createWriteStream(genesisFilePath)
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
  return bootnodesFile.trim().split(/\r?\n/).filter(enr => enr.trim());
}