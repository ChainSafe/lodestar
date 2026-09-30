import {CliCommand, CliCommandOptions} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {beaconHandler} from "./handler.js";
import {BeaconArgs, beaconOptions} from "./options.js";

export const beacon: CliCommand<BeaconArgs, GlobalArgs> = {
  command: "beacon",
  describe: "Run a beacon chain node",
  docsFolder: "run/beacon-management",
  examples: [
    {
      command: "beacon --network hoodi",
      description: "Run a beacon chain node and connect to the hoodi testnet",
    },
  ],
  options: beaconOptions as CliCommandOptions<BeaconArgs>,
  handler: beaconHandler,
};
