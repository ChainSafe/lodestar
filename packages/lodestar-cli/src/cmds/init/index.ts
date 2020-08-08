import {ICliCommand} from "../../util";
import {IBeaconOptions, beaconOptions} from "../beacon/options";
import {initHandler} from "./init";
import {IGlobalArgs} from "../../options";

export const init: ICliCommand<IBeaconOptions, IGlobalArgs> = {
  command: "init",
  describe: "Initialize lodestar",
  options: beaconOptions,
  handler: initHandler
};
