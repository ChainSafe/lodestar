import {ICliCommand, ICliCommandOptions} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {beaconOptions, IBeaconArgs} from "./options.js";
import {beaconLightHandler} from "./handler.js";

export const beaconLight: ICliCommand<IBeaconArgs, IGlobalArgs> = {
  command: "lc-p2p",
  describe: "Run a beacon chain node as light client",
  examples: [
    {
      command: "beacon --network goerli",
      description: "Run a beacon light chain node and connect to the goerli testnet",
    },
  ],
  options: beaconOptions as ICliCommandOptions<IBeaconArgs>,
  handler: beaconLightHandler,
};
