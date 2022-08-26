import {ICliCommand, ICliCommandOptions} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {IBeaconArgs, beaconOptions} from "../beacon/options.js";
import {initHandler, ReturnType} from "./handler.js";

export {ReturnType};

export const init: ICliCommand<IBeaconArgs, IGlobalArgs, ReturnType> = {
  command: "init",
  describe:
    "Initialize Lodestar directories and files necessary to run a beacon chain node. \
This step is not required, and should only be used to prepare special configurations",
  examples: [
    {
      command: "init --network goerli",
      description:
        "Initialize a configuration for the Goerli testnet. " +
        "Then, you can edit a config file to customize your beacon node settings",
    },
  ],
  options: beaconOptions as ICliCommandOptions<IBeaconArgs>,
  handler: initHandler,
};
