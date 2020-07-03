import {CommandModule} from "yargs";
import {run} from "./run";
import {devRunOptions, IDevOptions} from "./options";

export const devCommandModule: CommandModule<{}, IDevOptions> = {
  command: "dev",
  describe: "Command used to quickly bootstrap beacon node and validators",
  builder: devRunOptions,
  handler: run,
};
