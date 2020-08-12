import {ICliCommand, ICliCommandOptions} from "../../util";
import {IBeaconArgs, beaconOptions} from "../beacon/options";
import {initHandler} from "./handler";
import {IGlobalArgs} from "../../options";

export const init: ICliCommand<IBeaconArgs, IGlobalArgs> = {
  command: "init",
  describe: "Initialize lodestar",
  options: beaconOptions as ICliCommandOptions<IBeaconArgs>,
  handler: initHandler
};
