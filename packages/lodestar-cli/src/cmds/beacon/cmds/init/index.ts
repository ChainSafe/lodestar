import {CommandModule} from "yargs";
import {IBeaconOptions} from "../../options";
import {initHandler} from "./init";

export const init: CommandModule<IBeaconOptions, IBeaconOptions> = {
  command: "init",
  describe: "Initialize lodestar beacon node",
  handler: initHandler
};
