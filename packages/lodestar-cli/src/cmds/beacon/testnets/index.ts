import fs from "fs";
import path from "path";
import stream from "stream";
import {promisify} from "util";
import got from "got";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {IBeaconArgs} from "../options";

type Testnet = "altona";

export function getTestnetConfig(testnet: Testnet): Partial<IBeaconNodeOptions> {
  switch (testnet) {
    case "altona":
      return JSON.parse(fs.readFileSync(path.join(__dirname, "altona.json"), "utf8"));
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

function getGenesisFileUrl(testnet: Testnet): string {
  switch (testnet) {
    case "altona":
      return "https://github.com/eth2-clients/eth2-testnets/raw/master/shared/altona/genesis.ssz";
    default:
      throw Error(`Testnet not supported: ${testnet}`);
  }
}

/**
 * Downloads a genesis file per testnet if it does not exist
 * @param options
 */
export async function downloadGenesisFile(
  testnet: "altona",
  options: Partial<IBeaconArgs>
): Promise<void> {
  const genesisFileUrl = getGenesisFileUrl(testnet);
  const genesisFilePath = options.chain.genesisStateFile;

  if (!fs.existsSync(genesisFilePath)) {
    fs.mkdirSync(path.parse(genesisFilePath).dir, {recursive: true});
    await promisify(stream.pipeline)(
      got.stream(genesisFileUrl),
      fs.createWriteStream(genesisFilePath)
    );
  }
}