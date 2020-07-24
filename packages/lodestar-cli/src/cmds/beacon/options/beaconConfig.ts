import * as path from "path";
import {IYargsOptionsMap} from "../../../util/yargs";
import {TestnetName} from "../testnets";
import {IBeaconDirArgs}  from "./beaconDir";

export interface IBeaconConfigArgs extends IBeaconDirArgs {
  config: string;
  testnet?: TestnetName;
}

export const beaconConfigOptions = (args: IBeaconDirArgs): IYargsOptionsMap => ({
  "configFile": {
    alias: ["config"],
    default: path.join(args.beaconDir, "beacon.config.json"),
    description: "Beacon node configuration file",
    type: "string",
    normalize: true,
  },

  "testnet": {
    description: "Use a testnet configuration and genesis file",
    type: "string",
    choices: ["altona"] as TestnetName[],
  }
});
