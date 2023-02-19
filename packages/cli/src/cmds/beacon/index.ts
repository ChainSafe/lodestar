import {CliCommand, CliCommandOptions} from "../../util/index.js";
import {GlobalArgs} from "../../options/index.js";
import {beaconOptions, BeaconArgs} from "./options.js";
import {beaconHandler} from "./handler.js";

export const beacon: CliCommand<BeaconArgs, GlobalArgs> = {
  command: "beacon",
  describe: "Run a beacon chain node",
  examples: [
    {
      command: "beacon --network goerli",
      description: "Run a beacon chain node and connect to the goerli testnet",
    },
  ],
  options: beaconOptions as CliCommandOptions<BeaconArgs>,
  handler: beaconHandler,
};
