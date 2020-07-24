import {join} from "path";
import {IYargsOptionsMap} from "../../../util/yargs";
import {IGlobalArgs} from "../../../options";

export interface IBeaconDirArgs extends IGlobalArgs {
  beaconDir: string;
}

export const beaconDirOptions = (args: IBeaconDirArgs): IYargsOptionsMap => ({
  "beaconDir": {
    default: join(args.rootDir, "beacon"),
    hidden: true,
    type: "string",
  }
});
