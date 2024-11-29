import {CliCommand, CliCommandOptions} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {devHandler} from "./handler.js";
import {IDevArgs, devOptions} from "./options.js";

export const dev: CliCommand<IDevArgs, GlobalArgs> = {
  command: "dev",
  describe: "Quickly bootstrap a beacon node and multiple validators. Use for development and testing",
  docsFolder: "contribution",
  examples: [
    {
      command: "dev --genesisValidators 8 --reset",
      description: "Start a single beacon node with 8 interop validators",
    },
  ],
  options: devOptions as CliCommandOptions<IDevArgs>,
  handler: devHandler,
};
