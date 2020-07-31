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
  //seems like we need to define all beaconOptions in IGlobalArgs
  // @ts-ignore
    .command(init)
    .command(run),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {
  }
};
