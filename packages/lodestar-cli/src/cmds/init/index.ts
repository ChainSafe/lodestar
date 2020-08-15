import {ICliCommand, ICliCommandOptions} from "../../util";
import {IBeaconArgs, beaconOptions} from "../beacon/options";
import {initHandler} from "./handler";
import {IGlobalArgs} from "../../options";

export const init: ICliCommand<IBeaconArgs, IGlobalArgs> = {
  command: "init",
  describe: "Initialize Lodestar directories and files necessary to run a beacon chain node. \
This step is not required, and should only be used to prepare special configurations",
  options: beaconOptions as ICliCommandOptions<IBeaconArgs>,
  handler: initHandler
};
