import * as path from "path";
import {Options, Argv} from "yargs";
import {IGlobalArgs} from "../../../options";
import {IBeaconDirArgs}  from "./beaconDir";

export interface IBeaconFileArgs extends IBeaconDirArgs {
  configPath: string;
  dbPath: string;
  peerIdPath: string;
  enrPath: string;
}

export const configPath = (args: IBeaconDirArgs): Options => ({
  alias: ["configPath", "config"],
  default: path.join(args.beaconDir, "beacon.config.json"),
  description: "Beacon node configuration file",
  type: "string",
});

export const dbPath = (args: IBeaconDirArgs): Options => ({
  hidden: true,
  default: path.join(args.beaconDir, "beacon-db"),
  type: "string",
});

export const peerIdPath = (args: IBeaconDirArgs): Options => ({
  hidden: true,
  default: path.join(args.beaconDir, "peer-id.json"),
  type: "string",
});

export const enrPath = (args: IBeaconDirArgs): Options => ({
  hidden: true,
  default: path.join(args.beaconDir, "enr.json"),
  type: "string",
});
