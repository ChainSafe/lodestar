import {CliCommand, CliCommandOptions} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {beaconOptions, IBeaconArgs} from "./options.js";
import {beaconHandler} from "./handler.js";

export const beacon: CliCommand<IBeaconArgs, IGlobalArgs> = {
  command: "beacon",
  describe: "Run a beacon chain node",
  examples: [
    {
      command: "beacon --network goerli",
      description: "Run a beacon chain node and connect to the goerli testnet",
    },
  ],
  options: beaconOptions as CliCommandOptions<IBeaconArgs>,
  handler: beaconHandler,
};
