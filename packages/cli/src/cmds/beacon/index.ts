import {ICliCommand, ICliCommandOptions} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {beaconOptions, IBeaconArgs} from "./options.js";
import {beaconHandler} from "./handler.js";

export const beacon: ICliCommand<IBeaconArgs, IGlobalArgs> = {
  command: "beacon",
  describe: "Run a beacon chain node",
  examples: [
    {
      command: "beacon --network prater",
      description: "Run a beacon chain node and connect to the prater testnet",
    },
  ],
  options: beaconOptions as ICliCommandOptions<IBeaconArgs>,
  handler: beaconHandler,
};
