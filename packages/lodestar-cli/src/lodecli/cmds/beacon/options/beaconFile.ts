import * as path from "path";
import {Options} from "yargs";

import {IBeaconConfigArgs}  from "./beaconConfig";

export interface IBeaconFileArgs extends IBeaconConfigArgs {
  dbPath: string;
  network: {
    peerIdPath: string;
    enrPath: string;
  };
}

export const dbPath = (args: IBeaconConfigArgs): Options => ({
  alias: ["dbPath", "db.path", "db.name"],
  hidden: true,
  default: path.join(args.beaconDir, "chain-db"),
  normalize: true,
  type: "string",
});

export const peerIdPath = (args: IBeaconConfigArgs): Options => ({
  alias: ["network.peerIdPath"],
  hidden: true,
  default: path.join(args.beaconDir, "peer-id.json"),
  normalize: true,
  type: "string",
});

export const enrPath = (args: IBeaconConfigArgs): Options => ({
  alias: ["network.enrPath"],
  hidden: true,
  default: path.join(args.beaconDir, "enr.json"),
  normalize: true,
  type: "string",
});
