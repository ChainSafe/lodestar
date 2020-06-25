import {join} from "path";
import {Options} from "yargs";

export interface IBeaconDirArgs extends IGlobalArgs {
  beaconDir: string;
}

import {IGlobalArgs} from "../../../options";

export const beaconDir = (args: IGlobalArgs): Options => ({
  default: join(args.rootDir, "beacon"),
  hidden: true,
  type: "string",
});
