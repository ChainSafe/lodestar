import {ICliCommand, ICliCommandOptions} from "../../util";
import {IGlobalArgs} from "../../options";
import {IBeaconArgs, beaconOptions} from "../beacon/options";
import {getBeaconPaths} from "../beacon/paths";
import {initHandler} from "./handler";

export const init: ICliCommand<IBeaconArgs, IGlobalArgs> = {
  command: "init",
  describe: "Initialize Lodestar directories and files necessary to run a beacon chain node. \
This step is not required, and should only be used to prepare special configurations",
  examples: [{
    command: "init --testnet medalla",
    description: "Initialize a configuration for the Medalla testnet. " +
    `Then, you can edit the config file ${getBeaconPaths({rootDir: ".medalla"})} to customize your beacon node settings`
  }],
  options: beaconOptions as ICliCommandOptions<IBeaconArgs>,
  handler: initHandler
};
