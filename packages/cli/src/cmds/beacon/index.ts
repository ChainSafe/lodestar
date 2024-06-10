import {CliCommand, CliCommandOptions} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {beaconOptions, BeaconArgs} from "./options.js";
import {beaconHandler} from "./handler.js";

export const beacon: CliCommand<BeaconArgs, GlobalArgs> = {
  command: "beacon",
  describe: "Run a beacon chain node",
  docsFolder: "run/beacon-management",
  examples: [
    {
      command: "beacon --network holesky",
      description: "Run a beacon chain node and connect to the holesky testnet",
    },
  ],
  options: beaconOptions as CliCommandOptions<BeaconArgs>,
  handler: beaconHandler,
};
