import * as path from "path";
import {IYargsOptionsMap} from "../../../util/yargs";
import {IBeaconConfigArgs}  from "./beaconConfig";

export interface IBeaconFileArgs extends IBeaconConfigArgs {
  dbDir: string;
  network: {
    peerIdFile: string;
    enrFile: string;
  };
}

export const beaconFileOptions = (args: IBeaconConfigArgs): IYargsOptionsMap => ({
  "dbDir": {
    alias: ["db.dir", "db.name"],
    hidden: true,
    default: path.join(args.beaconDir, "chain-db"),
    normalize: true,
    type: "string",
  },

  "network.peerIdFile": {
    hidden: true,
    default: path.join(args.beaconDir, "peer-id.json"),
    normalize: true,
    type: "string",
  },

  "network.enrFile": {
    hidden: true,
    default: path.join(args.beaconDir, "enr.json"),
    normalize: true,
    type: "string",
  }
});
