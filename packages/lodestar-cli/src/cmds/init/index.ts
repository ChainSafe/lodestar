import {ICliCommand, ICliCommandOptions} from "../../util";
import {IBeaconOptions, beaconOptions} from "../beacon/options";
import {initHandler} from "./handler";
import {IGlobalArgs} from "../../options";

export const init: ICliCommand<IBeaconOptions, IGlobalArgs> = {
  command: "init",
  describe: "Initialize lodestar",
  options: beaconOptions as ICliCommandOptions<IBeaconOptions>,
  handler: initHandler
};
