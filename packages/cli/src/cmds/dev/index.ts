import {ICliCommand, ICliCommandOptions} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {devOptions, IDevArgs} from "./options.js";
import {devHandler} from "./handler.js";

export const dev: ICliCommand<IDevArgs, IGlobalArgs> = {
  command: "dev",
  describe: "Quickly bootstrap a beacon node and multiple validators. Use for development and testing",
  examples: [
    {
      command: "dev --genesisValidators 8 --reset",
      description: "Start a single beacon node with 8 interop validators",
    },
  ],
  options: devOptions as ICliCommandOptions<IDevArgs>,
  handler: devHandler,
};
