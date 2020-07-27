import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../options";
import {beaconOptions, IBeaconOptions} from "./options";
import {init} from "./cmds/init";
import {run} from "./cmds/run";

export const beacon: CommandModule<IGlobalArgs, IBeaconOptions> = {
  command: "beacon <command>",
  describe: "Beacon node",
  builder: (yargs) => yargs
    .options(beaconOptions)
    .command(init as CommandModule<IGlobalArgs, IBeaconOptions>)
    .command(run as CommandModule<IGlobalArgs, IBeaconOptions>),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {}
};
