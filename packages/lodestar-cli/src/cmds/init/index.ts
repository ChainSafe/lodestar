import {ICliCommand, ICliCommandOptions} from "../../util";
import {IGlobalArgs} from "../../options";
import {IBeaconArgs, beaconOptions} from "../beacon/options";
import {getBeaconPaths} from "../beacon/paths";
import {initHandler, ReturnType} from "./handler";

const defaultBeaconPathsPyrmont = getBeaconPaths({rootDir: ".pyrmont"});

export {ReturnType};

export const init: ICliCommand<IBeaconArgs, IGlobalArgs, ReturnType> = {
  command: "init",
  describe:
    "Initialize Lodestar directories and files necessary to run a beacon chain node. \
This step is not required, and should only be used to prepare special configurations",
  examples: [
    {
      command: "init --network pyrmont",
      description:
        "Initialize a configuration for the Pyrmont testnet. " +
        `Then, you can edit the config file ${defaultBeaconPathsPyrmont.configFile} to customize your beacon node settings`,
    },
  ],
  options: beaconOptions as ICliCommandOptions<IBeaconArgs>,
  handler: initHandler,
};
