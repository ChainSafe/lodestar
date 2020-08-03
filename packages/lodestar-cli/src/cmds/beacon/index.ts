import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../options";
import {beaconOptions, IBeaconOptions} from "./options";
import {run} from "./run";

export const beacon: CommandModule<IGlobalArgs, IBeaconOptions> = {
  command: "beacon",
  describe: "Run a beacon node",
  builder: beaconOptions,
  handler: run
};
