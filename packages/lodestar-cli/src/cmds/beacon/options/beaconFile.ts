import * as path from "path";
import {Options} from "yargs";

import {IBeaconConfigArgs}  from "./beaconConfig";

export interface IBeaconFileArgs extends IBeaconConfigArgs {
  dbDir: string;
  network: {
    peerIdFile: string;
    enrFile: string;
  };
}

export const dbDir = (args: IBeaconConfigArgs): Options => ({
  alias: ["dbDir", "db.dir", "db.name"],
  hidden: true,
  default: path.join(args.beaconDir, "chain-db"),
  normalize: true,
  type: "string",
});

export const peerIdFile = (args: IBeaconConfigArgs): Options => ({
  alias: ["network.peerIdFile"],
  hidden: true,
  default: path.join(args.beaconDir, "peer-id.json"),
  normalize: true,
  type: "string",
});

export const enrFile = (args: IBeaconConfigArgs): Options => ({
  alias: ["network.enrFile"],
  hidden: true,
  default: path.join(args.beaconDir, "enr.json"),
  normalize: true,
  type: "string",
});
