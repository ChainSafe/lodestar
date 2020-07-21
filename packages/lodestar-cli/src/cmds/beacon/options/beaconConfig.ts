import * as path from "path";
import {Options} from "yargs";
import {TestnetName} from "../testnets";
import {IBeaconDirArgs}  from "./beaconDir";

export interface IBeaconConfigArgs extends IBeaconDirArgs {
  config: string;
  testnet?: TestnetName;
}

export const config = (args: IBeaconDirArgs): Options => ({
  default: path.join(args.beaconDir, "beacon.config.json"),
  alias: ["configFile", "config"],
  description: "Beacon node configuration file",
  type: "string",
  normalize: true,
});

export const testnet = (): Options => ({
  description: "Use a testnet configuration and genesis file",
  type: "string",
  choices: ["altona"] as TestnetName[],
});
