import {CommandModule} from "yargs";
import {IBeaconOptions, beaconOptions} from "../beacon/options";
import {initHandler} from "./init";
import {IGlobalArgs} from "../../options";

export const init: CommandModule<IGlobalArgs, IBeaconOptions> = {
  command: "init",
  describe: "Initialize lodestar",
  builder: beaconOptions,
  handler: initHandler
};
