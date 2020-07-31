import {CommandModule} from "yargs";
import {IBeaconOptions} from "../../options";
import {initHandler} from "./init";
import {IGlobalArgs} from "../../../../options";

export const init: CommandModule<IGlobalArgs, IBeaconOptions> = {
  command: "init",
  describe: "Initialize lodestar beacon node",
  handler: initHandler
};
