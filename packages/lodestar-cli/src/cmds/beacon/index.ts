import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../options";
import {beaconOptions, IBeaconOptions} from "./options";
import {init} from "./cmds/init";
import {run} from "./cmds/run";
import {readBeaconConfig} from "./config";
import {parseArgs} from "../../util";

export const beacon: CommandModule<IGlobalArgs, IBeaconOptions> = {
  command: "beacon <command>",
  describe: "Beacon node",
  builder: (yargs) => {
    const args = parseArgs(yargs) as IBeaconOptions;
    return yargs
      .config(readBeaconConfig(args.templateConfigFile))
      .config(readBeaconConfig(args.configFile))
      .options(beaconOptions)
      // Deep type error with the command's options
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .command(init as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .command(run as any);
  },
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {}
};
