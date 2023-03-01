import {CliCommand, CliCommandOptions} from "../../util/index.js";
import {GlobalArgs} from "../../options/index.js";
import {devOptions, IDevArgs} from "./options.js";
import {devHandler} from "./handler.js";

export const dev: CliCommand<IDevArgs, GlobalArgs> = {
  command: "dev",
  describe: "Quickly bootstrap a beacon node and multiple validators. Use for development and testing",
  examples: [
    {
      command: "dev --genesisValidators 8 --reset",
      description: "Start a single beacon node with 8 interop validators",
    },
  ],
  options: devOptions as CliCommandOptions<IDevArgs>,
  handler: devHandler,
};
