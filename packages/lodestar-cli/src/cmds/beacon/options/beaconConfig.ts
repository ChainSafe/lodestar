import * as path from "path";
import {Options} from "yargs";

import {IBeaconDirArgs}  from "./beaconDir";

export interface IBeaconConfigArgs extends IBeaconDirArgs {
  config: string;
  altona?: boolean;
}

export const config = (args: IBeaconDirArgs): Options => ({
  default: path.join(args.beaconDir, "beacon.config.json"),
  alias: ["configFile", "config"],
  description: "Beacon node configuration file",
  type: "string",
  normalize: true,
});

export const altona = (): Options => ({
  description: "Use Altona testnet configuration and genesis file",
  type: "boolean",
});
