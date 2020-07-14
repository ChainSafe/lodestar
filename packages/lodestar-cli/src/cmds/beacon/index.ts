import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../options";
import {mergeBeaconOptions} from "./options";
import * as init from "./cmds/init";
import * as run from "./cmds/run";

export const beacon: CommandModule<IGlobalArgs, IGlobalArgs> = {
  command: "beacon <command>",
  describe: "Beacon node",
  builder: (yargs) => mergeBeaconOptions(yargs)
    .command(init)
    .command(run),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {}
};
