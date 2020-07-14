import {CommandModule} from "yargs";
import {devRunOptions, IDevOptions} from "./options";
import {run} from "./run";

export const dev: CommandModule<{}, IDevOptions> = {
  command: "dev",
  describe: "Command used to quickly bootstrap beacon node and validators",
  builder: devRunOptions,
  handler: run
};
