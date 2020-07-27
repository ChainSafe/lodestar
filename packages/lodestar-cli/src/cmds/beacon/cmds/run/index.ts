import {CommandModule} from "yargs";
import {IBeaconOptions} from "../../options";
import {runHandler} from "./run";

export const run: CommandModule<IBeaconOptions, IBeaconOptions> = {
  command: "run",
  describe: "Run a lodestar beacon node",
  handler: runHandler
};
